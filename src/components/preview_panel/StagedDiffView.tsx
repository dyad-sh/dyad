import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  stagedDiffFileAtom,
  diffEditModeAtom,
  diffContentEditableAtom,
  diffDirtyAtom,
  diffSavingAtom,
} from "@/atoms/viewAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useUncommittedFileDiff } from "@/hooks/useUncommittedFileDiff";
import {
  getStatusIcon,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";
import { FileDiffEditor } from "./FileDiffEditor";
import { isDiffPlaceholder } from "@/shared/diff_placeholders";

interface StagedDiffViewProps {
  appId: number;
  restartOnSwitchedToMainBranch?: boolean;
}

/**
 * Shows the staged (uncommitted) files on the left and a read-only side-by-side
 * Monaco diff of the selected file (HEAD vs working tree) on the right.
 */
export function StagedDiffView({
  appId,
  restartOnSwitchedToMainBranch = false,
}: StagedDiffViewProps) {
  const { t } = useTranslation("home");
  const { uncommittedFiles, isLoading } = useUncommittedFiles(appId);
  const [selectedPath, setSelectedPath] = useAtom(stagedDiffFileAtom);
  const editMode = useAtomValue(diffEditModeAtom);
  const setEditMode = useSetAtom(diffEditModeAtom);
  const setDiffContentEditable = useSetAtom(diffContentEditableAtom);
  const setDirty = useSetAtom(diffDirtyAtom);
  const setSaving = useSetAtom(diffSavingAtom);

  // Derive the displayed file from the user's selection, falling back to the
  // first staged file so a valid selection shows even if the clicked file was
  // just committed away.
  const selected =
    uncommittedFiles.find((f) => f.path === selectedPath) ??
    uncommittedFiles[0] ??
    null;

  const {
    diff,
    loading: diffLoading,
    error: diffError,
  } = useUncommittedFileDiff(appId, selected?.path ?? null);

  // A deleted file has an empty working-tree side (newContent === ""), which
  // isn't a placeholder, so it would otherwise read as editable — typing into
  // the empty pane and saving would re-create the file on disk, resurrecting
  // something the staged list shows as "deleted". Keep deleted files read-only,
  // mirroring VersionDiffView.
  //
  // Binary and oversized files come back as placeholder strings (the backend
  // substitutes them so they aren't rendered as garbage). Editing one and saving
  // would overwrite the real file with the placeholder text — corrupting a
  // binary asset — so such diffs must stay read-only. Only allow editing when
  // both sides are real content. While the diff is still loading (`!diff`),
  // default to editable; the guard re-runs once it resolves.
  const selectedContentEditable =
    selected?.status !== "deleted" &&
    (!diff ||
      (!isDiffPlaceholder(diff.oldContent) &&
        !isDiffPlaceholder(diff.newContent)));

  // Switching to a different file (or app) starts read-only so unsaved edits on
  // the previous file never silently carry over, and a stale dirty flag never
  // enables Save for a file that hasn't been touched. `appId` is a dependency so
  // switching apps while the same path stays selected still resets to read-only.
  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    setSaving(false);
  }, [appId, selected?.path, setEditMode, setDirty, setSaving]);

  // Keep the shared content-editable flag in sync with the selected file: a
  // binary/oversized (placeholder) diff disables the edit affordance entirely
  // and forces edit mode off. Reset to editable on unmount so a later text diff
  // isn't left stuck read-only.
  useEffect(() => {
    setDiffContentEditable(selectedContentEditable);
    if (!selectedContentEditable) {
      setEditMode(false);
      setDirty(false);
      setSaving(false);
    }
    return () => {
      setDiffContentEditable(true);
    };
  }, [
    selectedContentEditable,
    setDiffContentEditable,
    setEditMode,
    setDirty,
    setSaving,
  ]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.loadingChanges")}
      </div>
    );
  }

  if (uncommittedFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.noStagedChanges")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="staged-diff-view">
      <div className="w-1/3 border-r overflow-auto min-h-0">
        {uncommittedFiles.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedPath(file.path)}
            data-testid="staged-diff-file"
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--background-darkest)]",
              selected?.path === file.path && "bg-[var(--background-darkest)]",
            )}
          >
            {getStatusIcon(file.status)}
            <span
              className={cn(
                "flex-1 truncate font-mono text-xs",
                file.status === "deleted" && "line-through opacity-60",
              )}
              title={file.path}
            >
              {file.path}
            </span>
            <LineStats file={file} />
          </button>
        ))}
      </div>
      <div className="w-2/3 min-h-0">
        {selected && diff && !diffLoading ? (
          <FileDiffEditor
            // Remount on edit-mode change so each edit session starts fresh from
            // the current content: toggling off cleanly discards unsaved edits
            // and never leaves a stale value shown as if it were the diff.
            key={`${appId}:${selected.path}:${editMode}`}
            filePath={selected.path}
            oldContent={diff.oldContent}
            newContent={diff.newContent}
            editable={editMode && selectedContentEditable}
            appId={appId}
            restartOnSwitchedToMainBranch={restartOnSwitchedToMainBranch}
          />
        ) : diffLoading ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            {t("preview.loadingChanges")}
          </div>
        ) : (
          // Not loading and no diff: the request failed (or returned nothing).
          // Show an error instead of a perpetual "loading" state so the user can
          // pick another file or retry.
          <div className="flex h-full items-center justify-center text-gray-500">
            {diffError
              ? t("preview.failedToLoadChanges")
              : t("preview.noChangesToDisplay")}
          </div>
        )}
      </div>
    </div>
  );
}
