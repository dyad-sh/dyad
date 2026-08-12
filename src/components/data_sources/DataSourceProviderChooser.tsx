import { useQuery } from "@tanstack/react-query";
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

function CloudflareSetup({ onBack }: { onBack: () => void }) {
  const environment = useQuery({
    queryKey: ["cloudflare-environment"],
    queryFn: () => ipc.cloudflare.detectEnvironment(),
  });

  const env = environment.data;

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

      {/* Said plainly rather than shown as a button that does nothing. */}
      <div className="rounded-xl border border-amber-400/25 bg-amber-500/8 p-3 text-xs leading-5 text-amber-100/85">
        This is as far as Cloudflare D1 is built. Detection works; installing
        Wrangler, signing in, listing and creating databases, the schema
        designer, migrations and the query gateway are not implemented yet, so
        there is nothing here that would connect a database today.
      </div>

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
          <CloudflareSetup onBack={() => onChoose(null)} />
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
