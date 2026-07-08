import { useMemo } from "react";
import { useSetAtom } from "jotai";
import { Loader2, RefreshCw, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVersionChanges } from "@/hooks/useVersionChanges";
import { computeLineDiffStats } from "@/lib/lineDiffStats";
import {
  previewModeAtom,
  selectedVersionIdAtom,
  selectedVersionDiffFileAtom,
} from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { STATUS_META } from "@/components/preview_panel/VersionDiffView";

interface ModifiedFilesCardProps {
  appId: number;
  commitHash: string;
  onUndo: () => void;
  isUndoLoading: boolean;
  onRetry: () => void;
  isRetryLoading: boolean;
}

function splitPath(filePath: string): { dir: string; name: string } {
  const index = filePath.lastIndexOf("/");
  if (index === -1) {
    return { dir: "", name: filePath };
  }
  return {
    dir: filePath.slice(0, index + 1),
    name: filePath.slice(index + 1),
  };
}

/**
 * Card shown at the bottom of the chat after a generation finishes, summarizing
 * the files changed by that generation (one row per file with +/- line counts).
 * Clicking a row opens the read-only diff view for that file in the preview
 * panel; the Undo button reverts the whole generation.
 */
export function ModifiedFilesCard({
  appId,
  commitHash,
  onUndo,
  isUndoLoading,
  onRetry,
  isRetryLoading,
}: ModifiedFilesCardProps) {
  const { changes, loading, error } = useVersionChanges(appId, commitHash);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setSelectedVersionId = useSetAtom(selectedVersionIdAtom);
  const setSelectedVersionDiffFile = useSetAtom(selectedVersionDiffFileAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);

  const statsByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeLineDiffStats>>();
    for (const file of changes ?? []) {
      map.set(
        file.path,
        computeLineDiffStats(file.oldContent, file.newContent),
      );
    }
    return map;
  }, [changes]);

  const openDiff = (filePath: string) => {
    setSelectedVersionDiffFile({ versionId: commitHash, path: filePath });
    setSelectedVersionId(commitHash);
    setPreviewMode("code");
    setIsPreviewOpen(true);
  };

  // The file list is unavailable while loading, on error, or when the commit
  // changed no user-visible files. In those cases we still render the Undo/Retry
  // footer (the assistant turn produced a commit, so those affordances must stay
  // available); only the header + list are hidden.
  const hasChanges = !loading && !error && !!changes && changes.length > 0;

  const footer = (
    <div className="px-3 py-2 border-t border-border/60 flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        data-testid="modified-files-retry"
        disabled={isRetryLoading}
        onClick={onRetry}
        className="gap-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:border-border cursor-pointer transition-colors disabled:cursor-not-allowed"
      >
        {isRetryLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} />
        )}
        Retry
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="modified-files-undo"
        disabled={isUndoLoading}
        onClick={onUndo}
        className="gap-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:border-border cursor-pointer transition-colors disabled:cursor-not-allowed"
      >
        {isUndoLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Undo size={16} />
        )}
        Undo
      </Button>
    </div>
  );

  return (
    <div className="max-w-3xl w-full mx-auto my-2 px-2">
      <div
        data-testid="modified-files-card"
        className="rounded-xl border border-border/60 bg-[var(--background-lightest)] overflow-hidden"
      >
        {hasChanges && (
          <div className="px-3 py-2 border-b border-border/60 text-sm font-medium">
            Modified files{" "}
            <span className="text-muted-foreground font-normal">
              ({changes.length})
            </span>
          </div>
        )}
        {hasChanges && (
          <div className="max-h-64 overflow-y-auto divide-y divide-border/60">
            {changes.map((file) => {
              const stats = statsByPath.get(file.path);
              const meta = STATUS_META[file.type];
              const { dir, name } = splitPath(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  data-testid="modified-files-row"
                  onClick={() => openDiff(file.path)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm cursor-pointer hover:bg-[var(--background-lighter)] transition-colors"
                  title={file.path}
                >
                  <span
                    className={cn(
                      "flex-shrink-0 w-4 text-center font-mono text-xs font-semibold",
                      meta.className,
                    )}
                    title={file.type}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {dir && (
                      <span className="text-muted-foreground">{dir}</span>
                    )}
                    <span className="font-medium">{name}</span>
                  </span>
                  {stats && (
                    <span className="flex-shrink-0 flex items-center gap-2 font-mono text-xs">
                      {stats.additions > 0 && (
                        <span className="text-green-600 dark:text-green-400">
                          +{stats.additions}
                        </span>
                      )}
                      {stats.deletions > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          -{stats.deletions}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
