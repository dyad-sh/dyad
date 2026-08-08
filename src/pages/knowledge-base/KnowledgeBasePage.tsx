import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GeneratingImageCard } from "@/components/chat-agent/GeneratingImageCard";
import {
  INDEXING_STAGES,
  KNOWLEDGE_IMPORT_STAGES,
} from "@/lib/image_generation_stages";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { ipc } from "@/ipc/types";
import type {
  KnowledgeBaseDocument,
  KnowledgeBaseImportProgress,
} from "@/ipc/types/vector";
import { showError, showSuccess } from "@/lib/toast";
import { knowledgeBaseProgressPercent } from "@/lib/knowledge_base_progress";
import { cn } from "@/lib/utils";

const KNOWLEDGE_BASE_QUERY_KEY = ["knowledge-base", "overview"] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function friendlyDate(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Database;
}) {
  return (
    <div className="rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.6)] p-4 backdrop-blur-md">
      <div className="flex items-center gap-2 text-cyan-300/70">
        <Icon className="size-3.5" />
        <span className="font-jarvis-ui text-[11px] tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="mt-2 font-jarvis-display text-xl text-cyan-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-cyan-100/40">{hint}</p>}
    </div>
  );
}

const DOCUMENT_STATUS_STYLES: Record<KnowledgeBaseDocument["status"], string> =
  {
    ready: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300/90",
    indexing: "border-cyan-400/25 bg-cyan-500/10 text-cyan-200/90",
    attention: "border-rose-400/25 bg-rose-500/10 text-rose-200/90",
    missing: "border-amber-400/25 bg-amber-500/10 text-amber-200/90",
  };

function DocumentRow({
  document,
  onRetry,
  onRemove,
  isBusy,
  isRetrying,
}: {
  document: KnowledgeBaseDocument;
  onRetry: (document: KnowledgeBaseDocument) => void;
  onRemove: (document: KnowledgeBaseDocument) => void;
  isBusy: boolean;
  isRetrying: boolean;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-cyan-400/10 px-4 py-3 first:border-t-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-400/5 font-mono text-[10px] text-cyan-200/70 uppercase">
        {document.extension || "txt"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-cyan-50">{document.name}</p>
        <p className="truncate text-xs text-cyan-100/40">
          {document.chunkCount} chunk{document.chunkCount === 1 ? "" : "s"} ·{" "}
          {formatBytes(document.sizeBytes)} ·{" "}
          {friendlyDate(document.lastIndexedAt)}
        </p>
        {document.error && (
          <p className="mt-1 max-w-2xl text-xs leading-5 text-rose-300/80">
            {document.error}
          </p>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 rounded-md border px-2 py-0.5 text-[11px]",
          DOCUMENT_STATUS_STYLES[document.status],
        )}
      >
        {document.status}
      </span>
      {document.status === "attention" && (
        <button
          type="button"
          onClick={() => onRetry(document)}
          disabled={isBusy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-rose-300/25 bg-rose-400/5 px-2.5 text-xs text-rose-100 hover:bg-rose-400/10 disabled:opacity-40"
          aria-label={`Retry indexing ${document.name}`}
        >
          {isRetrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Fix
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(document)}
        disabled={isBusy}
        aria-label={`Remove ${document.name} from the Knowledge Base`}
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-400/15 text-cyan-200/50 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient();
  const [importProgress, setImportProgress] =
    useState<KnowledgeBaseImportProgress | null>(null);
  const [retryingDocumentId, setRetryingDocumentId] = useState<string | null>(
    null,
  );

  useEffect(
    () =>
      ipc.events.vector.onKnowledgeBaseImportProgress((progress) => {
        setImportProgress(progress);
      }),
    [],
  );

  const overviewQuery = useQuery({
    queryKey: KNOWLEDGE_BASE_QUERY_KEY,
    queryFn: () => ipc.vector.getKnowledgeBase(),
    // Keep the status and chunk counts fresh while indexing runs. A source
    // may outlive an interrupted engine job, so its own state must also keep
    // polling until the main process repairs it to `attention`.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status.state === "indexing" ||
        data?.documents.some((document) => document.status === "indexing")
        ? 1_500
        : false;
    },
  });

  const overview = overviewQuery.data;

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: KNOWLEDGE_BASE_QUERY_KEY });
  const reportError = (error: unknown) =>
    showError(error instanceof Error ? error.message : "That did not work.");

  const indexMutation = useMutation({
    mutationFn: () => ipc.vector.indexKnowledgeBase(),
    onSuccess: (result) => {
      setImportProgress(null);
      queryClient.setQueryData(KNOWLEDGE_BASE_QUERY_KEY, result);
      refresh();
      showSuccess(
        `Indexed ${result.documentCount} document${
          result.documentCount === 1 ? "" : "s"
        }`,
      );
    },
    onError: (error) => {
      setImportProgress(null);
      reportError(error);
    },
  });

  const addMutation = useMutation({
    mutationFn: () => ipc.vector.addKnowledgeBaseDocuments(),
    onSuccess: (result) => {
      setImportProgress(null);
      queryClient.setQueryData(KNOWLEDGE_BASE_QUERY_KEY, result);
      refresh();
      showSuccess("Documents added and indexed");
    },
    onError: (error) => {
      setImportProgress(null);
      reportError(error);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (document: KnowledgeBaseDocument) => {
      setRetryingDocumentId(document.id);
      return ipc.vector.retryKnowledgeBaseDocument({
        documentId: document.id,
      });
    },
    onSuccess: (result, document) => {
      setImportProgress(null);
      queryClient.setQueryData(KNOWLEDGE_BASE_QUERY_KEY, result);
      const repaired = result.documents.find(
        (candidate) => candidate.id === document.id,
      );
      if (repaired?.status === "ready") {
        showSuccess(`${document.name} repaired and indexed`);
      } else {
        showError(
          repaired?.error
            ? `Still needs attention: ${repaired.error}`
            : `${document.name} still needs attention. Check the OCR model in Settings → Model Roles.`,
        );
      }
    },
    onError: (error) => {
      setImportProgress(null);
      reportError(error);
    },
    onSettled: () => setRetryingDocumentId(null),
  });

  const removeMutation = useMutation({
    mutationFn: (document: KnowledgeBaseDocument) =>
      ipc.vector.removeKnowledgeBaseDocument({
        documentId: document.id,
        deleteFile: false,
      }),
    onSuccess: () => {
      refresh();
      showSuccess("Removed from the index");
    },
    onError: reportError,
  });

  const isBusy =
    indexMutation.isPending ||
    addMutation.isPending ||
    retryMutation.isPending ||
    removeMutation.isPending;

  const hasVault = !!overview?.documentsFolder;
  const engineState = overview?.status.state ?? "stopped";
  const engineOnline = engineState === "ready" || engineState === "indexing";
  const calculatedProgressPercent = knowledgeBaseProgressPercent({
    progress: importProgress,
    isAdding: addMutation.isPending,
    documentCount: overview?.documentCount ?? 0,
    pendingCount: overview?.pendingCount ?? 0,
  });
  const progressPercent = hasVault ? calculatedProgressPercent : 0;
  const progressActive = importProgress !== null;
  const progressTitle = !hasVault
    ? "Choose a vault"
    : importProgress?.phase === "uploading"
      ? "Uploading to vault"
      : importProgress?.phase === "indexing"
        ? "Indexing documents"
        : overview?.pendingCount
          ? "Waiting to index"
          : "Index complete";
  const progressDetail = !hasVault
    ? "Select a local vault in Storage before adding documents."
    : importProgress
      ? `${
          importProgress.phase === "uploading" &&
          importProgress.completedBytes !== undefined &&
          importProgress.totalBytes !== undefined
            ? `${formatBytes(importProgress.completedBytes)} of ${formatBytes(importProgress.totalBytes)}`
            : `${importProgress.completedCount} of ${importProgress.totalCount} processed`
        }${
          importProgress.currentFile ? ` · ${importProgress.currentFile}` : ""
        }`
      : overview?.pendingCount
        ? `${overview.pendingCount} document${overview.pendingCount === 1 ? "" : "s"} waiting`
        : `${overview?.documentCount ?? 0} document${overview?.documentCount === 1 ? "" : "s"} searchable`;

  return (
    <div className="jarvis-workspace font-jarvis-ui h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 pt-[calc(var(--layout-title-bar-offset)+1.25rem)] pb-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-jarvis-display text-xl text-cyan-50">
              Knowledge Base
            </h1>
            <p className="mt-1 max-w-xl text-sm text-cyan-100/45">
              Documents in your vault, embedded locally and searchable by every
              agent. Nothing leaves this Mac.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addMutation.mutate(undefined as never)}
              disabled={isBusy || !hasVault}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40"
              data-testid="knowledge-base-add"
            >
              {addMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add documents
            </button>
            <button
              type="button"
              onClick={() => indexMutation.mutate(undefined as never)}
              disabled={isBusy || !hasVault}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-sm font-medium text-white shadow-[0_0_18px_rgba(0,229,255,0.3)] hover:opacity-90 disabled:opacity-40"
              data-testid="knowledge-base-index-now"
            >
              {indexMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Index now
            </button>
          </div>
        </header>

        {/* Engine + embedder status */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Vector engine"
            value={engineOnline ? "Online" : "Offline"}
            hint={overview?.status.message ?? "Checking…"}
            icon={Database}
          />
          <StatCard
            label="Index size"
            value={formatBytes(overview?.storageBytes ?? 0)}
            hint="Qdrant storage on disk"
            icon={HardDrive}
          />
          <StatCard
            label="Documents"
            value={String(overview?.documentCount ?? 0)}
            hint={
              overview?.pendingCount
                ? `${overview.pendingCount} waiting to index`
                : "All documents indexed"
            }
            icon={FileText}
          />
          <StatCard
            label="Chunks"
            value={String(overview?.chunkCount ?? 0)}
            hint={`${overview?.embeddingModel ?? "Local embedder"} · ${
              overview?.dimensions ?? 384
            }d`}
            icon={Layers}
          />
        </section>

        <section
          className="mt-4 rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.6)] px-4 py-3 backdrop-blur-md"
          aria-label="Knowledge Base indexing progress"
          data-testid="knowledge-base-progress"
        >
          <div className="mb-2 flex items-center gap-2">
            {progressActive ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-cyan-300" />
            ) : !hasVault ? (
              <HardDrive className="size-4 shrink-0 text-cyan-300/60" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-300/80" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-cyan-50">{progressTitle}</p>
              <p className="truncate text-xs text-cyan-100/45">
                {progressDetail}
              </p>
            </div>
            <span className="font-mono text-sm text-cyan-100/80">
              {progressActive && progressPercent === 0
                ? "Working"
                : `${progressPercent}%`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-valuetext={`${progressPercent}% ${progressTitle}`}
            className="h-2 overflow-hidden rounded-full border border-cyan-400/15 bg-cyan-950/70"
          >
            <div
              className={cn(
                "relative h-full rounded-full bg-cyan-400 transition-[width] duration-500 ease-out",
                progressActive &&
                  "animate-pulse shadow-[0_0_12px_rgba(34,211,238,0.65)]",
              )}
              style={{
                width:
                  progressActive && progressPercent === 0
                    ? "28%"
                    : `${progressPercent}%`,
              }}
            >
              {progressActive && (
                <span className="absolute inset-0 animate-pulse bg-white/25" />
              )}
            </div>
          </div>
        </section>

        {/* Vault folder */}
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.6)] px-4 py-3 backdrop-blur-md">
          <FolderOpen className="size-4 shrink-0 text-cyan-300/70" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-cyan-100/45">Documents folder</p>
            <p className="truncate font-mono text-xs text-cyan-100/70">
              {overview?.documentsFolder ?? "No vault folder selected"}
            </p>
          </div>
          {hasVault ? (
            <button
              type="button"
              onClick={() => void ipc.vector.openDocumentsFolder()}
              className="rounded-lg border border-cyan-400/20 px-3 py-1.5 text-xs text-cyan-100/80 hover:bg-cyan-400/10"
            >
              Open folder
            </button>
          ) : (
            <Link
              to="/storage"
              className="rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs text-cyan-100"
            >
              Choose a vault
            </Link>
          )}
        </section>

        {!hasVault && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300/80" />
            <p className="text-xs leading-5 text-amber-100/80">
              Pick a local vault folder in Storage first. Drop documents into
              its <span className="font-mono">Documents</span> folder — or use
              Add documents — and they become searchable knowledge.
            </p>
          </div>
        )}

        {/* Indexed documents */}
        <section className="mt-6 overflow-hidden rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.6)] backdrop-blur-md">
          <header className="flex items-center gap-2 border-b border-cyan-400/10 px-4 py-3">
            <Boxes className="size-3.5 text-cyan-300/70" />
            <h2 className="font-jarvis-ui text-[11px] tracking-widest text-cyan-300/70 uppercase">
              Indexed documents
            </h2>
            <span className="ml-auto font-mono text-[11px] text-cyan-100/35">
              {overview?.documents.length ?? 0}
            </span>
          </header>

          {addMutation.isPending && importProgress ? (
            <div className="flex justify-center px-4 py-8">
              <GeneratingImageCard
                label="Adding documents"
                stages={KNOWLEDGE_IMPORT_STAGES}
                activeStageIndex={importProgress.phase === "uploading" ? 0 : 1}
                footnote={`${importProgress.totalCount} document${
                  importProgress.totalCount === 1 ? "" : "s"
                } · Files and embeddings stay on this device.`}
              />
            </div>
          ) : indexMutation.isPending || retryMutation.isPending ? (
            <div className="flex justify-center px-4 py-8">
              <GeneratingImageCard
                label="Indexing"
                stages={INDEXING_STAGES}
                footnote="Documents are read, split and embedded locally."
              />
            </div>
          ) : overviewQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-cyan-100/40">
              Loading the index…
            </p>
          ) : !overview || overview.documents.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-cyan-100/40">
              {hasVault
                ? "No documents indexed yet. Add documents, then choose Index now."
                : "Choose a vault folder to start building your Knowledge Base."}
            </p>
          ) : (
            <ul>
              {overview.documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  onRetry={(target) => retryMutation.mutate(target)}
                  onRemove={(target) => removeMutation.mutate(target)}
                  isBusy={isBusy}
                  isRetrying={
                    retryMutation.isPending &&
                    retryingDocumentId === document.id
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 text-xs text-cyan-100/35">
          Last indexed {friendlyDate(overview?.lastIndexedAt)}. Agents search
          this knowledge through the Vector workspace.
        </p>
      </div>
    </div>
  );
}
