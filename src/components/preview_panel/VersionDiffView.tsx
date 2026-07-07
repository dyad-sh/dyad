import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useVersionChanges } from "@/hooks/useVersionChanges";
import type { VersionChangedFile } from "@/ipc/types";
import { selectedVersionDiffFileAtom } from "@/atoms/appAtoms";
import { FileDiffEditor } from "./FileDiffEditor";

interface VersionDiffViewProps {
  appId: number;
  versionId: string;
}

export const STATUS_META: Record<
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
  const { changes, loading, error } = useVersionChanges(appId, versionId);
  // The selected file is held in a shared atom so external callers (e.g. the
  // modified-files card in the chat) can open the diff at a specific file. The
  // displayed selection is derived during render (below) so switching versions
  // never flashes the placeholder while waiting for an effect to reconcile a
  // stale path.
  const [selectedDiffPath, setSelectedDiffPath] = useAtom(
    selectedVersionDiffFileAtom,
  );

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

  // Derive the displayed file from the shared selection, falling back to the
  // first changed file. Computing this during render (rather than via an effect)
  // means a version switch immediately shows a valid selection even when the
  // previously selected path is absent in the new version.
  const selected =
    (selectedDiffPath
      ? changes.find((c) => c.path === selectedDiffPath)
      : undefined) ?? changes[0];
  const selectedPath = selected?.path ?? null;

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="version-diff-view"
    >
      <div className="w-1/3 border-r overflow-auto min-h-0">
        {changes.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedDiffPath(file.path)}
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
      <div className="w-2/3 min-h-0">
        <FileDiffEditor
          key={`${appId}:${selected.path}`}
          filePath={selected.path}
          oldContent={selected.oldContent}
          newContent={selected.newContent}
        />
      </div>
    </div>
  );
}
