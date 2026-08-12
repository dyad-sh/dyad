import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import type { DataSourceDto } from "@/ipc/types/data_source";
import { showError, showSuccess } from "@/lib/toast";
import { DataSourceDialog } from "@/components/data_sources/DataSourceDialog";
import {
  DataSourceProviderChooser,
  type DataSourceProvider,
} from "@/components/data_sources/DataSourceProviderChooser";

/**
 * Data Sources.
 *
 * Connected databases MyMeta can read. Everything on this page comes from the
 * main process; nothing here has ever seen a credential, and the card can only
 * report whether one is set because that is the only thing the DTO carries.
 */

const ENVIRONMENT_LABELS: Record<DataSourceDto["environment"], string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
  other: "Other",
};

const CREDENTIAL_LABELS: Record<DataSourceDto["credentialType"], string> = {
  publishable: "Publishable Key",
  anon: "Anon Key",
  secret: "Secret Key",
  service_role: "Service Role Key",
};

const STATUS_STYLE: Record<
  DataSourceDto["status"],
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  connected: {
    label: "Connected",
    className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
    Icon: CheckCircle2,
  },
  syncing: {
    label: "Discovering schema",
    className: "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
    Icon: Loader2,
  },
  connection_error: {
    label: "Connection error",
    className: "border-rose-400/30 bg-rose-500/10 text-rose-300",
    Icon: XCircle,
  },
  auth_error: {
    label: "Authentication error",
    className: "border-rose-400/30 bg-rose-500/10 text-rose-300",
    Icon: XCircle,
  },
  disabled: {
    label: "Disabled",
    className: "border-white/15 bg-white/5 text-white/45",
    Icon: AlertTriangle,
  },
  unknown: {
    label: "Not tested",
    className: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    Icon: AlertTriangle,
  },
};

function formatWhen(epoch: number | null): string {
  if (!epoch) return "Never";
  return new Date(epoch).toLocaleString();
}

function DataSourceCard({
  source,
  onEdit,
}: {
  source: DataSourceDto;
  onEdit: (source: DataSourceDto) => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["data-sources"] });

  const status = STATUS_STYLE[source.status];

  const test = useMutation({
    mutationFn: () => ipc.dataSource.test({ id: source.id }),
    onSuccess: async (health) => {
      await invalidate();
      // The per-check detail is the useful part; a bare pass/fail would send
      // the user back to guessing which half is wrong.
      const failed = health.checks.filter((check) => !check.ok);
      if (health.ok) {
        showSuccess(
          `Connected. ${health.tablesDiscovered ?? 0} tables visible.`,
        );
      } else {
        showError(
          failed.map((check) => `${check.name}: ${check.detail}`).join(" · "),
        );
      }
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Test failed"),
  });

  const sync = useMutation({
    mutationFn: () => ipc.dataSource.syncSchema({ id: source.id }),
    onSuccess: async (result) => {
      await invalidate();
      showSuccess(
        `Discovered ${result.tables} tables, ${result.columns} columns and ${result.relationships} relationships.`,
      );
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Schema sync failed"),
  });

  const remove = useMutation({
    mutationFn: () => ipc.dataSource.delete({ id: source.id }),
    onSuccess: async () => {
      await invalidate();
      showSuccess("Data source removed");
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Could not remove"),
  });

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      ipc.dataSource.update({ id: source.id, enabled }),
    onSuccess: async () => {
      await invalidate();
      showSuccess(
        source.enabled ? "Data source disabled" : "Data source enabled",
      );
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Could not update"),
  });

  const busy =
    test.isPending ||
    sync.isPending ||
    remove.isPending ||
    setEnabled.isPending;

  return (
    <div
      className="ops-holo-card flex flex-col justify-between p-5"
      data-testid={`data-source-card-${source.id}`}
    >
      <div className="relative z-10">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200">
            <Database className="size-5" />
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
          >
            <status.Icon
              className={`size-3 ${source.status === "syncing" ? "animate-spin" : ""}`}
            />
            {status.label}
          </span>
        </div>

        <h2 className="truncate font-jarvis-display text-lg font-semibold text-white">
          {source.name}
        </h2>
        <p className="mt-0.5 text-xs text-white/40">
          {source.provider} · {ENVIRONMENT_LABELS[source.environment]} · read
          only
        </p>
        {source.description && (
          <p className="mt-2 line-clamp-2 text-sm text-[#7aadb8]">
            {source.description}
          </p>
        )}
        <p className="mt-2 truncate font-mono text-[11px] text-cyan-200/60">
          {source.projectUrl}
        </p>

        {/* Failure reason, already sanitised in the main process. */}
        {source.statusMessage && (
          <p className="mt-2 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
            {source.statusMessage}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <dt className="text-white/35">Key ID</dt>
            {/* Names the credential without naming the secret. */}
            <dd className="font-mono text-white/80">{source.keyId || "—"}</dd>
          </div>
          <div>
            <dt className="text-white/35">Type</dt>
            <dd className="text-white/80">
              {CREDENTIAL_LABELS[source.credentialType]}
            </dd>
          </div>
          <div>
            <dt className="text-white/35">Last connected</dt>
            <dd className="text-white/80">
              {formatWhen(source.lastConnectedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-white/35">Readable tables</dt>
            <dd className="text-white/80">{source.tableCount}</dd>
          </div>
        </dl>

        {!source.hasCredential && (
          <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
            Add a connection key to use this source.
          </p>
        )}
      </div>

      <div className="relative z-10 mt-5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => test.mutate()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09] disabled:opacity-40"
        >
          {test.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plug className="size-3.5" />
          )}
          Test
        </button>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={busy || !source.hasCredential}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09] disabled:opacity-40"
          data-testid={`data-source-sync-${source.id}`}
        >
          {sync.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Sync schema
        </button>
        <button
          type="button"
          onClick={() => setEnabled.mutate(!source.enabled)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09] disabled:opacity-40"
        >
          {source.enabled ? (
            <PowerOff className="size-3.5" />
          ) : (
            <Power className="size-3.5" />
          )}
          {source.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={() => onEdit(source)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09] disabled:opacity-40"
        >
          <Pencil className="size-3.5" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            // Destructive and easy to hit by accident, so it asks first.
            if (
              window.confirm(
                `Remove "${source.name}"? This deletes the saved credentials and discovered schema from MyMeta. Nothing is changed in the Supabase project itself.`,
              )
            ) {
              remove.mutate();
            }
          }}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

export default function DataSourcesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Connecting starts with which kind of source, not with a Supabase form.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chosenProvider, setChosenProvider] =
    useState<DataSourceProvider | null>(null);
  const [editing, setEditing] = useState<DataSourceDto | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => ipc.dataSource.list(),
  });

  const openNew = () => {
    setEditing(null);
    setChosenProvider(null);
    setChooserOpen(true);
  };

  return (
    <div className="settings-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="manager-brand-icon">
                <Database className="size-4" />
              </div>
              <span className="manager-brand-label font-jarvis-ui">
                DATA SOURCES
              </span>
              <div className="manager-status-dot manager-status-dot--active" />
            </div>
            <h1 className="manager-title font-jarvis-display">
              Connect your data to MyMeta
            </h1>
            <p className="manager-subtitle">
              Connect a Supabase database and MyMeta AI can securely search,
              analyse and answer questions about the information stored inside
              it. Connections are read-only.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25"
            data-testid="data-source-connect"
          >
            <Plus className="size-4" />
            Connect data source
          </button>
        </header>

        {sourcesQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Loader2 className="size-4 animate-spin" />
            Loading data sources…
          </div>
        )}

        {sourcesQuery.isError && (
          <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm text-rose-200">
            Could not load data sources.{" "}
            {sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : ""}
            <button
              type="button"
              onClick={() => sourcesQuery.refetch()}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}

        {sourcesQuery.data?.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200">
              <Database className="size-5" />
            </div>
            <h2 className="font-jarvis-display text-lg font-semibold text-white">
              Connect your data to MyMeta
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#7aadb8]">
              Connect a Supabase database and MyMeta AI can securely search,
              analyse and answer questions about the information stored inside
              it.
            </p>
            <button
              type="button"
              onClick={openNew}
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25"
              data-testid="data-source-connect-empty"
            >
              <Plus className="size-4" />
              Connect Supabase
            </button>
          </div>
        )}

        {sourcesQuery.data && sourcesQuery.data.length > 0 && (
          <section className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sourcesQuery.data.map((source) => (
              <DataSourceCard
                key={source.id}
                source={source}
                onEdit={(target) => {
                  setEditing(target);
                  setDialogOpen(true);
                }}
              />
            ))}
          </section>
        )}
      </main>

      <DataSourceProviderChooser
        open={chooserOpen}
        chosen={chosenProvider}
        onChoose={setChosenProvider}
        onClose={() => setChooserOpen(false)}
        onChooseSupabase={() => {
          setChooserOpen(false);
          setDialogOpen(true);
        }}
      />

      <DataSourceDialog
        open={dialogOpen}
        source={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
