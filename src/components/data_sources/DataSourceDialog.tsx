import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plug, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/ipc/types";
import type { DataSourceDto } from "@/ipc/types/data_source";
import { showError, showSuccess } from "@/lib/toast";

/**
 * Add and edit a Supabase data source.
 *
 * Both secret fields are write-only. On an edit they start blank and say a
 * credential is saved: leaving one blank keeps what is stored, typing into one
 * replaces it. That is the same three-state convention the agent cards use,
 * and it is what stops a rename from silently wiping a credential.
 *
 * The form never receives a stored secret, so there is nothing here to leak.
 */

const ENVIRONMENTS = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
  { value: "other", label: "Other" },
] as const;

const CREDENTIAL_TYPES = [
  { value: "publishable", label: "Publishable Key" },
  { value: "anon", label: "Anon Key" },
  { value: "secret", label: "Secret Key" },
  { value: "service_role", label: "Service Role Key" },
] as const;

type HealthCheck = { name: string; ok: boolean; detail: string };

export function DataSourceDialog({
  open,
  source,
  onClose,
}: {
  open: boolean;
  source: DataSourceDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(source);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [environment, setEnvironment] =
    useState<DataSourceDto["environment"]>("development");
  const [credentialType, setCredentialType] =
    useState<DataSourceDto["credentialType"]>("publishable");
  const [connectionKey, setConnectionKey] = useState("");
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);

  // Reset when the dialog is opened for a different source, so an edit never
  // shows the previous one's values.
  useEffect(() => {
    if (!open) return;
    setName(source?.name ?? "");
    setDescription(source?.description ?? "");
    setProjectUrl(source?.projectUrl ?? "");
    setEnvironment(source?.environment ?? "development");
    setCredentialType(source?.credentialType ?? "publishable");
    // Always blank: the stored key is never sent to the renderer, so there is
    // nothing to prefill with even if we wanted to.
    setConnectionKey("");
    setChecks(null);
  }, [open, source]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["data-sources"] });

  const test = useMutation({
    mutationFn: () =>
      ipc.dataSource.test({
        ...(source ? { id: source.id } : {}),
        projectUrl,
        // Blank means "use what is stored" on an edit, and "nothing" on a new
        // source; sending undefined expresses both.
        connectionKey: connectionKey.trim() || undefined,
      }),
    onSuccess: (health) => {
      setChecks(health.checks);
      if (health.ok) {
        showSuccess(
          `Connected. ${health.tablesDiscovered ?? 0} tables visible.`,
        );
      }
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Test failed"),
  });

  /**
   * Saves, then discovers.
   *
   * Discovery runs straight after a successful save so the card arrives
   * populated rather than empty: a source you have to remember to sync is a
   * source that sits at zero tables and looks broken.
   */
  const save = useMutation({
    mutationFn: async () => {
      const saved = source
        ? await ipc.dataSource.update({
            id: source.id,
            name,
            description,
            projectUrl,
            environment,
            credentialType,
            connectionKey: connectionKey.trim() || undefined,
          })
        : await ipc.dataSource.create({
            name,
            description,
            projectUrl,
            environment,
            credentialType,
            connectionKey: connectionKey.trim() || undefined,
          });

      if (saved.hasCredential) {
        try {
          await ipc.dataSource.syncSchema({ id: saved.id });
        } catch (error) {
          // A save that worked must not be reported as a failure because
          // discovery did not; the card shows the reason and offers a retry.
          showError(
            error instanceof Error
              ? `Saved, but schema discovery failed: ${error.message}`
              : "Saved, but schema discovery failed.",
          );
        }
      }
      return saved;
    },
    onSuccess: async () => {
      await invalidate();
      showSuccess(editing ? "Data source updated" : "Data source connected");
      onClose();
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Could not save"),
  });

  const canSave = name.trim().length > 0 && projectUrl.trim().length > 0;
  const busy = save.isPending || test.isPending;

  const field =
    "w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 disabled:opacity-50";
  const label = "text-xs font-medium tracking-wide text-white/50 uppercase";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit data source" : "Connect Supabase"}
          </DialogTitle>
          <DialogDescription>
            MyMeta connects read-only. Schema discovery uses the PostgreSQL
            connection; nothing is installed into your Supabase project.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-name">
              Data source name
            </label>
            <input
              id="ds-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main production database"
              className={field}
              data-testid="data-source-name"
            />
          </div>

          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-description">
              Description (optional)
            </label>
            <input
              id="ds-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={field}
            />
          </div>

          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-environment">
              Environment
            </label>
            <select
              id="ds-environment"
              value={environment}
              onChange={(event) =>
                setEnvironment(
                  event.target.value as DataSourceDto["environment"],
                )
              }
              className={field}
            >
              {ENVIRONMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-url">
              Supabase project URL
            </label>
            <input
              id="ds-url"
              value={projectUrl}
              onChange={(event) => setProjectUrl(event.target.value)}
              placeholder="https://xxxxxxxx.supabase.co"
              className={field}
              data-testid="data-source-url"
            />
          </div>

          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-credential-type">
              Credential type
            </label>
            <select
              id="ds-credential-type"
              value={credentialType}
              onChange={(event) =>
                setCredentialType(
                  event.target.value as DataSourceDto["credentialType"],
                )
              }
              className={field}
            >
              {CREDENTIAL_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={label} htmlFor="ds-connection-key">
              Connection key
            </label>
            <input
              id="ds-connection-key"
              type="password"
              autoComplete="off"
              value={connectionKey}
              onChange={(event) => setConnectionKey(event.target.value)}
              placeholder={
                source?.hasCredential
                  ? "•••••••••••••••• — Key saved"
                  : "sb_publishable_… or a legacy anon/service key"
              }
              className={field}
              data-testid="data-source-connection-key"
            />
            <p className="text-[11px] leading-5 text-white/35">
              {source?.hasCredential
                ? "Leave blank to keep the saved key, or paste a new one to replace it."
                : "MyMeta reads only what this key is allowed to read, so the project's own access rules still apply."}
            </p>
          </div>

          {/* Per-check results, so a failure says which half is wrong. */}
          {checks && (
            <ul className="space-y-1 rounded-lg border border-white/10 bg-black/20 p-3">
              {checks.map((check) => (
                <li
                  key={check.name}
                  className="flex items-start gap-2 text-[12px]"
                >
                  {check.ok ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
                  )}
                  <span className="text-white/70">
                    <span className="text-white/90">{check.name}:</span>{" "}
                    {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => test.mutate()}
              disabled={busy || !projectUrl.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-white/80 hover:bg-white/[0.09] disabled:opacity-40"
              data-testid="data-source-test"
            >
              {test.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              Test connection
            </button>
            <button
              type="submit"
              disabled={busy || !canSave}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
              data-testid="data-source-save"
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Save connection"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="ml-auto rounded-lg px-3 py-2 text-sm text-white/50 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
