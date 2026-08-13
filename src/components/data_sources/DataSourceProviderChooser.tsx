import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Cloud,
  Database,
  HardDrive,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProposedSchema } from "@/lib/data_sources/d1_schema_design";
import { d1Endpoint } from "@/lib/data_sources/d1_endpoint";
import type { CloudflareD1Database } from "@/ipc/types/cloudflare";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";

/**
 * Which kind of data source to connect.
 *
 * Supabase opens the form that already existed. Cloudflare D1 begins with the
 * only part of its setup that is built: inspecting the machine. That screen
 * says plainly what is present and what is not yet implemented, rather than
 * offering a button that pretends to provision anything.
 */

export type DataSourceProvider = "supabase" | "cloudflare-d1" | "local";

const PROVIDERS: Array<{
  id: DataSourceProvider;
  name: string;
  summary: string;
  detail: string;
  icon: typeof Database;
  available: boolean;
}> = [
  {
    id: "supabase",
    name: "Supabase",
    summary: "Hosted Postgres",
    detail: "Connect a Supabase project with its URL and a connection key.",
    icon: Database,
    available: true,
  },
  {
    id: "cloudflare-d1",
    name: "Cloudflare D1",
    summary: "Serverless SQL, free tier available",
    detail:
      "Connect a Cloudflare account and use an existing D1 database, or have one designed and created for you.",
    icon: Cloud,
    available: true,
  },
  {
    id: "local",
    name: "Local database",
    summary: "A SQLite file on this machine",
    detail: "Open a database file that never leaves this computer.",
    icon: HardDrive,
    available: false,
  },
];

function CloudflareSetup({
  onBack,
  onConnected,
}: {
  onBack: () => void;
  onConnected: () => void;
}) {
  const [apiToken, setApiToken] = useState("");
  // Browser sign-in is the default path; the token is there for machines that
  // cannot open a browser.
  const [useToken, setUseToken] = useState(false);
  const [newName, setNewName] = useState("");
  const [description, setDescription] = useState("");
  const [design, setDesign] = useState<ProposedSchema | null>(null);
  const [databases, setDatabases] = useState<CloudflareD1Database[] | null>(
    null,
  );

  const environment = useQuery({
    queryKey: ["cloudflare-environment"],
    queryFn: () => ipc.cloudflare.detectEnvironment(),
  });

  /**
   * What we already know about reaching Cloudflare.
   *
   * Asked before anything is offered. Someone who signed in last week should
   * see their databases, not a sign-in button.
   */
  const auth = useQuery({
    queryKey: ["cloudflare-auth-state"],
    queryFn: () => ipc.cloudflare.authState(),
  });

  const alreadyAuthenticated = Boolean(
    auth.data?.signedIn || auth.data?.hasStoredToken,
  );

  // Listing runs on its own once we know there is a way in, so the databases
  // are simply there.
  useEffect(() => {
    if (!alreadyAuthenticated || databases !== null) return;
    if (auth.data?.signedIn) {
      resumeSignedIn.mutate();
    } else {
      resumeWithStoredToken.mutate();
    }
    // Running once per authenticated state is the intent; re-running on every
    // mutation identity change would list repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyAuthenticated, auth.data?.signedIn, databases]);

  const queryClient = useQueryClient();
  const env = environment.data;

  /**
   * Install Wrangler if needed, sign in through the browser, then list.
   *
   * One button rather than three steps: the user's part is approving in the
   * browser, and everything either side of that is ours to do.
   */
  const signIn = useMutation({
    mutationFn: async () => {
      await ipc.cloudflare.ensureWrangler();
      await ipc.cloudflare.loginWithBrowser();
      return ipc.cloudflare.listSignedInDatabases();
    },
    onSuccess: async (found) => {
      await environment.refetch();
      setDatabases(
        found.map((database) => ({
          uuid: database.uuid,
          name: database.name,
          // Wrangler lists databases for the signed-in account, which the
          // environment check has already named.
          accountId: environment.data?.account?.accountId ?? "",
          accountName: environment.data?.account?.email ?? "Signed in",
          fileSizeBytes: null,
        })),
      );
    },
    onError: (error: Error) => showError(error.message),
  });

  const listDatabases = useMutation({
    mutationFn: async () => {
      const found = await ipc.cloudflare.listDatabases({
        apiToken: apiToken.trim(),
      });
      // It worked, so it is worth keeping: a second database should not mean
      // pasting the same token again.
      await ipc.cloudflare.saveApiToken({ apiToken: apiToken.trim() });
      await auth.refetch();
      return found;
    },
    onSuccess: setDatabases,
    onError: (error: Error) => showError(error.message),
  });

  /** Lists again using the sign-in Wrangler already holds. */
  const resumeSignedIn = useMutation({
    mutationFn: () => ipc.cloudflare.listSignedInDatabases(),
    onSuccess: (found) =>
      setDatabases(
        found.map((database) => ({
          uuid: database.uuid,
          name: database.name,
          accountId: auth.data?.accountId ?? "",
          accountName: auth.data?.email ?? "Signed in",
          fileSizeBytes: null,
        })),
      ),
    onError: (error: Error) => showError(error.message),
  });

  /** Lists using the token already stored, without showing it. */
  const resumeWithStoredToken = useMutation({
    mutationFn: () => ipc.cloudflare.listDatabases({ apiToken: "" }),
    onSuccess: setDatabases,
    onError: () => {
      // A stored token that no longer works should not leave the user staring
      // at a spinner: fall back to asking.
      setUseToken(true);
    },
  });

  /**
   * Save a database as a data source.
   *
   * The endpoint is the projectUrl and the token is the credential, so
   * everything downstream — testing, schema sync, querying — works through the
   * same rows and the same encryption as Supabase.
   */
  /**
   * Saves a D1 database as a data source and syncs its schema.
   *
   * Shared by connecting an existing database and creating a new one, so both
   * produce the same row and neither can drift into saving it differently.
   */
  const connectDatabase = async (database: CloudflareD1Database) => {
    const created = await ipc.dataSource.create({
      name: database.name,
      description: `Cloudflare D1 · ${database.accountName}`,
      projectUrl: d1Endpoint(database.accountId, database.uuid),
      environment: "production",
      credentialType: "secret",
      // Empty when signed in through the browser: Wrangler holds that
      // credential, and storing nothing is better than storing a copy.
      connectionKey: useToken ? apiToken.trim() : "",
      provider: "cloudflare-d1",
    });
    // Discovering the schema is what makes it answerable in chat, so it
    // happens now rather than waiting for someone to press Sync.
    await ipc.dataSource.syncSchema({ id: created.id });
    return created;
  };

  /** Asks the designer for a structure. Creates nothing. */
  const designSchema = useMutation({
    mutationFn: () => ipc.cloudflare.designSchema({ description }),
    onSuccess: setDesign,
    onError: (error: Error) => showError(error.message),
  });

  /**
   * Create a database, then connect it.
   *
   * One action rather than two: a database created and left unconnected is a
   * thing the user has to go and find, and the only reason to make one here is
   * to use it.
   */
  const createAndConnect = useMutation({
    mutationFn: async () => {
      const created = await ipc.cloudflare.createDatabase({
        name: newName,
        // Present only on the token path; the browser path signs in through
        // Wrangler, which already knows the account.
        apiToken: useToken ? apiToken.trim() : undefined,
        accountId: useToken ? databases?.[0]?.accountId : undefined,
      });
      // The approved design is applied before the source is connected, so the
      // schema sync that follows sees the tables rather than an empty database.
      if (design) {
        await ipc.cloudflare.applySchema({
          databaseId: created.uuid,
          schema: design,
        });
      }

      return connectDatabase({
        uuid: created.uuid,
        name: created.name,
        accountId:
          created.accountId ??
          environment.data?.account?.accountId ??
          databases?.[0]?.accountId ??
          "",
        accountName: environment.data?.account?.email ?? "Cloudflare",
        fileSizeBytes: null,
      });
    },
    onSuccess: async (created) => {
      showSuccess(`${created.name} created and connected`);
      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onConnected();
    },
    onError: (error: Error) => showError(error.message),
  });

  /** Forgets both the stored token and the browser sign-in. */
  const signOut = useMutation({
    mutationFn: () => ipc.cloudflare.signOut(),
    onSuccess: async () => {
      setDatabases(null);
      setApiToken("");
      setUseToken(false);
      await Promise.all([auth.refetch(), environment.refetch()]);
      showSuccess("Signed out of Cloudflare");
    },
    onError: (error: Error) => showError(error.message),
  });

  const connect = useMutation({
    mutationFn: connectDatabase,
    onSuccess: async (created) => {
      showSuccess(`${created.name} connected`);
      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onConnected();
    },
    onError: (error: Error) => showError(error.message),
  });

  /** Present, absent, or still being looked for. Never guessed. */
  const Row = ({
    label,
    value,
    ok,
  }: {
    label: string;
    value: string;
    ok: boolean | null;
  }) => (
    <div className="flex items-center gap-2 border-b border-cyan-500/8 py-2 text-sm last:border-b-0">
      {ok === null ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-white/35" />
      ) : ok ? (
        <Check className="size-3.5 shrink-0 text-emerald-400" />
      ) : (
        <X className="size-3.5 shrink-0 text-amber-400" />
      )}
      <span className="min-w-0 flex-1 text-cyan-100/60">{label}</span>
      <span className="shrink-0 font-mono text-xs text-cyan-100/45">
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cyan-500/12 bg-[rgba(4,12,24,0.5)] px-3">
        <Row
          label="Operating system"
          value={env ? `${env.platform} ${env.arch}` : "checking…"}
          ok={env ? true : null}
        />
        <Row
          label="Node"
          value={
            env?.nodeVersion ??
            (environment.isLoading ? "checking…" : "not found")
          }
          ok={env ? Boolean(env.nodeVersion) : null}
        />
        <Row
          label="Package manager"
          value={env?.packageManager ?? "checking…"}
          ok={env ? true : null}
        />
        <Row
          label="Wrangler"
          value={
            env?.wranglerVersion ??
            (environment.isLoading ? "checking…" : "not installed")
          }
          ok={env ? Boolean(env.wranglerVersion) : null}
        />
        <Row
          label="Cloudflare account"
          value={
            env?.account?.email ??
            env?.account?.accountId ??
            (environment.isLoading
              ? "checking…"
              : env?.hasApiToken
                ? "API token present"
                : "not signed in")
          }
          ok={env ? Boolean(env.account || env.hasApiToken) : null}
        />
      </div>

      {alreadyAuthenticated && databases === null ? (
        <div className="flex items-center gap-2 text-sm text-cyan-100/55">
          <Loader2 className="size-4 animate-spin" />
          {/* Already known, so this is loading rather than asking. */}
          {auth.data?.signedIn
            ? `Signed in${auth.data.email ? ` as ${auth.data.email}` : ""} — finding your databases…`
            : "Using your saved Cloudflare token — finding your databases…"}
        </div>
      ) : databases === null && !useToken ? (
        <div className="space-y-3">
          <Button
            onClick={() => signIn.mutate()}
            disabled={signIn.isPending}
            className="w-full border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            data-testid="cloudflare-sign-in"
          >
            {signIn.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Waiting for Cloudflare authorization…
              </>
            ) : (
              <>
                <Cloud className="size-4" />
                Sign in with Cloudflare
              </>
            )}
          </Button>
          <p className="text-xs leading-5 text-cyan-100/40">
            Opens Cloudflare in your browser to approve access. Wrangler is
            installed first if this machine does not already have it, and the
            sign-in is kept by Wrangler rather than stored here.
          </p>
          <button
            type="button"
            onClick={() => setUseToken(true)}
            className="text-xs text-cyan-200/60 underline-offset-2 hover:underline"
          >
            Use an API token instead
          </button>
        </div>
      ) : databases === null ? (
        <div className="space-y-2">
          <Label htmlFor="cf-token">Cloudflare API token</Label>
          <Input
            id="cf-token"
            type="password"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
            placeholder="Token with D1 read access"
            data-testid="cloudflare-api-token"
          />
          <p className="text-xs leading-5 text-cyan-100/40">
            Create one at Cloudflare → My Profile → API Tokens, with permission
            to read accounts and D1. It is stored encrypted on this machine and
            never sent anywhere but Cloudflare.
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => listDatabases.mutate()}
              disabled={!apiToken.trim() || listDatabases.isPending}
              data-testid="cloudflare-list-databases"
            >
              {listDatabases.isPending ? "Looking…" : "Find my databases"}
            </Button>
            <Button variant="ghost" onClick={() => setUseToken(false)}>
              Back to sign-in
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {databases.length === 0 && (
            <p className="text-sm text-cyan-100/45">
              No D1 databases here yet. Create the first one below.
            </p>
          )}

          <div className="space-y-1.5">
            {databases.map((database) => (
              <button
                key={database.uuid}
                type="button"
                onClick={() => connect.mutate(database)}
                disabled={connect.isPending}
                className="flex w-full items-center gap-3 rounded-lg border border-cyan-400/15 bg-[rgba(5,16,31,0.6)] p-2.5 text-left hover:border-cyan-400/35 hover:bg-cyan-500/8"
                data-testid={`cloudflare-database-${database.uuid}`}
              >
                <Database className="size-4 shrink-0 text-cyan-300/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-cyan-50">
                    {database.name}
                  </span>
                  <span className="block truncate text-[10px] text-cyan-100/35">
                    {database.accountName}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-cyan-200/50" />
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-cyan-500/10 pt-3">
            <Label htmlFor="cf-new-db">Create a new database</Label>
            <div className="flex items-center gap-2">
              <Input
                id="cf-new-db"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="customers-db"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newName.trim()) {
                    createAndConnect.mutate();
                  }
                }}
                data-testid="cloudflare-new-database-name"
              />
              <Button
                onClick={() => createAndConnect.mutate()}
                disabled={!newName.trim() || createAndConnect.isPending}
                className="shrink-0 border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                data-testid="cloudflare-create-database"
              >
                {createAndConnect.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    Create
                  </>
                )}
              </Button>
            </div>
            {/* Describing it is optional: an empty database is a legitimate
                thing to want, and this is the other thing to want. */}
            <Label htmlFor="cf-describe">
              What should it store?{" "}
              <span className="text-cyan-100/35">optional</span>
            </Label>
            <Textarea
              id="cf-describe"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Customers, the projects they order, quotes and invoices for each project, and who worked on them."
              className="min-h-20 text-xs"
              data-testid="cloudflare-describe-database"
            />

            {description.trim().length > 2 && !design && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => designSchema.mutate()}
                disabled={designSchema.isPending}
                data-testid="cloudflare-design-schema"
              >
                {designSchema.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Designing…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Design the tables for me
                  </>
                )}
              </Button>
            )}

            {design && (
              <div className="space-y-2 rounded-lg border border-cyan-500/15 bg-[rgba(4,12,24,0.5)] p-3">
                {design.summary && (
                  <p className="text-xs leading-5 text-cyan-100/55">
                    {design.summary}
                  </p>
                )}
                <p className="text-[10px] uppercase tracking-wider text-cyan-100/35">
                  {design.tables.length}{" "}
                  {design.tables.length === 1 ? "table" : "tables"} · created
                  when you press Create
                </p>
                <ul className="space-y-1">
                  {design.tables.map((table) => (
                    <li key={table.name} className="text-xs">
                      <span className="text-cyan-50/85">{table.name}</span>
                      <span className="ml-2 text-cyan-100/35">
                        {table.columns.map((c) => c.name).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDesign(null)}
                  >
                    Discard design
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => designSchema.mutate()}
                    disabled={designSchema.isPending}
                  >
                    Design again
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs leading-5 text-cyan-100/40">
              {design
                ? "Nothing has been created yet. Create makes the database and its tables."
                : "Created empty unless you describe what it should store."}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          {alreadyAuthenticated && (
            <Button
              variant="ghost"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              data-testid="cloudflare-sign-out"
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void environment.refetch()}
            disabled={environment.isFetching}
          >
            {environment.isFetching ? "Checking…" : "Check again"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DataSourceProviderChooser({
  open,
  onClose,
  onChooseSupabase,
  chosen,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChooseSupabase: () => void;
  chosen: DataSourceProvider | null;
  onChoose: (provider: DataSourceProvider | null) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onChoose(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {chosen === "cloudflare-d1"
              ? "Cloudflare D1"
              : "Connect a data source"}
          </DialogTitle>
          <DialogDescription>
            {chosen === "cloudflare-d1"
              ? "What this machine already has."
              : "Where the data you want MyMeta to read lives."}
          </DialogDescription>
        </DialogHeader>

        {chosen === "cloudflare-d1" ? (
          <CloudflareSetup
            onBack={() => onChoose(null)}
            onConnected={() => {
              onChoose(null);
              onClose();
            }}
          />
        ) : (
          <div className="space-y-2">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!provider.available}
                onClick={() => {
                  if (provider.id === "supabase") {
                    onChoose(null);
                    onChooseSupabase();
                    return;
                  }
                  onChoose(provider.id);
                }}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border border-cyan-400/15 bg-[rgba(5,16,31,0.6)] p-3 text-left transition-colors",
                  provider.available
                    ? "hover:border-cyan-400/35 hover:bg-cyan-500/8"
                    : "cursor-not-allowed opacity-45",
                )}
                data-testid={`data-source-provider-${provider.id}`}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-500/8 text-cyan-200">
                  <provider.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-cyan-50">
                      {provider.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-cyan-100/35">
                      {provider.summary}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-cyan-100/45">
                    {/* An unavailable option says so here rather than looking
                        clickable and doing nothing. */}
                    {provider.available
                      ? provider.detail
                      : `${provider.detail} Not implemented yet.`}
                  </span>
                </span>
                {provider.available && (
                  <ArrowRight className="size-4 shrink-0 text-cyan-200/50 transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
