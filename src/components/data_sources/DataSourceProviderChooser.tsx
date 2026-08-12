import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Cloud,
  Database,
  HardDrive,
  Loader2,
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
  const [databases, setDatabases] = useState<CloudflareD1Database[] | null>(
    null,
  );

  const environment = useQuery({
    queryKey: ["cloudflare-environment"],
    queryFn: () => ipc.cloudflare.detectEnvironment(),
  });

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
    mutationFn: () =>
      ipc.cloudflare.listDatabases({ apiToken: apiToken.trim() }),
    onSuccess: setDatabases,
    onError: (error: Error) => showError(error.message),
  });

  /**
   * Save a database as a data source.
   *
   * The endpoint is the projectUrl and the token is the credential, so
   * everything downstream — testing, schema sync, querying — works through the
   * same rows and the same encryption as Supabase.
   */
  const connect = useMutation({
    mutationFn: async (database: CloudflareD1Database) => {
      const created = await ipc.dataSource.create({
        name: database.name,
        description: `Cloudflare D1 · ${database.accountName}`,
        projectUrl: d1Endpoint(database.accountId, database.uuid),
        environment: "production",
        credentialType: "secret",
        // Empty when signed in through the browser: Wrangler holds that
        // credential, and storing nothing is better than storing a copy.
        connectionKey: apiToken.trim(),
        provider: "cloudflare-d1",
      });
      // Discovering the schema is what makes it answerable in chat, so it
      // happens now rather than waiting for someone to press Sync.
      await ipc.dataSource.syncSchema({ id: created.id });
      return created;
    },
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

      {databases === null && !useToken ? (
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
      ) : databases.length === 0 ? (
        <p className="text-sm text-cyan-100/45">
          This token can see no D1 databases. Creating one from here is not
          built yet; create it in the Cloudflare dashboard and look again.
        </p>
      ) : (
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
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="outline"
          onClick={() => void environment.refetch()}
          disabled={environment.isFetching}
        >
          {environment.isFetching ? "Checking…" : "Check again"}
        </Button>
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
