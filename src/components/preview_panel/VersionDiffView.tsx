import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  useVersionChanges,
  useVersionFileChange,
} from "@/hooks/useVersionChanges";
import type { VersionChangedFile } from "@/ipc/types";
import { FileDiffEditor } from "./FileDiffEditor";

interface VersionDiffViewProps {
  appId: number;
  versionId: string;
}

const STATUS_META: Record<
  VersionChangedFile["type"],
  { label: string; className: string }
> = {
  added: { label: "A", className: "text-green-600 dark:text-green-400" },
  modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
};

function StatusBadge({ type }: { type: VersionChangedFile["type"] }) {
  const meta = STATUS_META[type];
  return (
    <span
      className={cn(
        "flex-shrink-0 w-4 text-center font-mono text-xs font-semibold",
        meta.className,
      )}
      title={type}
    >
      {meta.label}
    </span>
  );
}

/**
 * Shows the files changed in a single version (commit) on the left, and a
 * read-only side-by-side Monaco diff of the selected file on the right.
 */
export function VersionDiffView({ appId, versionId }: VersionDiffViewProps) {
  const { t } = useTranslation("home");
  const { changes, truncated, loading, error } = useVersionChanges(
    appId,
    versionId,
  );
  // Tracks the file the user explicitly clicked. The displayed selection is
  // derived during render (below) so switching versions never flashes the
  // placeholder while waiting for an effect to reconcile a stale path.
  const [userSelectedPath, setUserSelectedPath] = useState<string | null>(null);
  // Derive the displayed file from the user's explicit selection, falling back
  // to the first changed file. Computing this during render means a version
  // switch immediately selects a valid path without an effect race.
  const selected =
    (userSelectedPath
      ? changes?.find((change) => change.path === userSelectedPath)
      : undefined) ??
    changes?.[0] ??
    null;
  const selectedPath = selected?.path ?? null;
  const {
    change: selectedChange,
    loading: fileLoading,
    error: fileError,
  } = useVersionFileChange(appId, versionId, selected);
  const contentUnavailableReason = selectedChange
    ? selectedChange.oldContentStatus === "too-large" ||
      selectedChange.newContentStatus === "too-large"
      ? "too-large"
      : selectedChange.oldContentStatus === "binary" ||
          selectedChange.newContentStatus === "binary"
        ? "binary"
        : null
    : null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.loadingChanges")}
      </div>
    );
  }

  if (error) {
    // Surface a generic, user-friendly message rather than the raw git error
    // (which can include stderr like "fatal: bad object ..."). The underlying
    // error is logged for debugging.
    console.error("Failed to load version changes:", error);
    return (
      <div className="flex flex-1 items-center justify-center text-red-500">
        {t("preview.errorLoadingChanges")}
      </div>
    );
  }

  if (!changes || changes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.noChangesInVersion")}
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="version-diff-view"
    >
      <div className="w-1/3 border-r min-h-0 flex flex-col">
        <div className="overflow-auto min-h-0 flex-1">
          {changes.map((file) => (
            <button
              key={file.path}
              onClick={() => setUserSelectedPath(file.path)}
              data-testid="version-diff-file"
              className={cn(
                "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--background-darkest)]",
                selectedPath === file.path && "bg-[var(--background-darkest)]",
              )}
            >
              <StatusBadge type={file.type} />
              <span className="truncate" title={file.path}>
                {file.path}
              </span>
            </button>
          ))}
        </div>
        {truncated && (
          <div
            className="border-t px-3 py-2 text-xs text-muted-foreground"
            role="status"
          >
            {t("preview.tooManyVersionChanges")}
          </div>
        )}
      </div>
      <div className="w-2/3 min-h-0 flex items-center justify-center">
        {fileLoading ? (
          <div className="text-gray-500">{t("preview.loadingChanges")}</div>
        ) : fileError || !selectedChange ? (
          <div className="text-red-500">{t("preview.errorLoadingChanges")}</div>
        ) : contentUnavailableReason ? (
          <div className="px-4 text-center text-sm text-muted-foreground">
            {contentUnavailableReason === "too-large"
              ? t("preview.fileTooLarge")
              : t("preview.binaryNotSupported")}
          </div>
        ) : (
          <FileDiffEditor
            key={`${appId}:${versionId}:${selectedChange.path}`}
            filePath={selectedChange.path}
            oldContent={selectedChange.oldContent}
            newContent={selectedChange.newContent}
          />
        )}
      </div>
    </div>
  );
}
