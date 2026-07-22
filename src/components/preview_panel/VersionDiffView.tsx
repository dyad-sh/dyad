import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useVersionChanges } from "@/hooks/useVersionChanges";
import type { VersionChangedFile } from "@/ipc/types";
import {
  diffEditModeAtom,
  diffContentEditableAtom,
  diffDirtyAtom,
  diffSavingAtom,
} from "@/atoms/viewAtoms";
import { FileDiffEditor } from "./FileDiffEditor";
import { STATUS_META } from "./versionChangeMeta";
import { isDiffPlaceholder } from "@/shared/diff_placeholders";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { selectedDiffFileForState } from "@/version_preview/state";

interface VersionDiffViewProps {
  appId: number;
  versionId: string;
  writableBranchName?: string;
  expectedBranchTipOid?: string;
  restartOnSwitchedToMainBranch?: boolean;
}

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
 * side-by-side Monaco diff of the selected file on the right. The right pane
 * becomes editable when the version being shown is the writable branch tip.
 */
export function VersionDiffView({
  appId,
  versionId,
  writableBranchName,
  expectedBranchTipOid,
  restartOnSwitchedToMainBranch = false,
}: VersionDiffViewProps) {
  const { t } = useTranslation("home");
  const { changes, loading, error } = useVersionChanges(appId, versionId);
  // The selected file is held in the version-preview state machine so external
  // callers (e.g. the modified-files card in the chat) can open the diff at a
  // specific file. The selection is scoped to a version, so it is only applied
  // when it belongs to the version being shown (see below); this avoids a stale
  // path from another version leaking in without needing an effect to reconcile
  // it.
  const { state: previewState, send: sendPreviewEvent } =
    useVersionPreview(appId);
  const selectedDiffFile = selectedDiffFileForState(previewState);
  const selectedDiffPath =
    selectedDiffFile?.versionId === versionId ? selectedDiffFile.path : null;

  const editMode = useAtomValue(diffEditModeAtom);
  const setEditMode = useSetAtom(diffEditModeAtom);
  const setDiffContentEditable = useSetAtom(diffContentEditableAtom);
  const setDirty = useSetAtom(diffDirtyAtom);
  const setSaving = useSetAtom(diffSavingAtom);

  // Switching the shown file (or version) starts read-only so unsaved edits on
  // the previous file never silently carry over, and a stale dirty flag never
  // enables Save for a file that hasn't been touched.
  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    setSaving(false);
  }, [versionId, selectedDiffPath, setEditMode, setDirty, setSaving]);

  // Derive the displayed file from the shared selection, falling back to the
  // first changed file. Computing this during render (rather than via an effect)
  // means a version switch immediately shows a valid selection even when the
  // previously selected path is absent in the new version.
  const selected =
    changes && changes.length > 0
      ? ((selectedDiffPath
          ? changes.find((c) => c.path === selectedDiffPath)
          : undefined) ?? changes[0])
      : null;
  const selectedPath = selected?.path ?? null;
  // A deleted file has an empty right pane (newContent === ""), which isn't a
  // placeholder, so it would otherwise read as editable — typing into it and
  // saving would re-create the file on disk, resurrecting something the diff
  // badge shows as "deleted". Keep deleted files read-only. Binary/oversized
  // (placeholder) sides also stay read-only so their content is never saved
  // back as text.
  const selectedContentEditable =
    selected == null ||
    (selected.type !== "deleted" &&
      !isDiffPlaceholder(selected.oldContent) &&
      !isDiffPlaceholder(selected.newContent));
  const visibleChanges = changes ?? [];

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

  if (!selected || visibleChanges.length === 0) {
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
      <div className="w-1/3 border-r overflow-auto min-h-0">
        {visibleChanges.map((file) => (
          <button
            key={file.path}
            onClick={() =>
              sendPreviewEvent({
                type: "SELECT_DIFF_FILE",
                file: { versionId, path: file.path },
              })
            }
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
          // Remount on edit-mode change so each edit session starts fresh from
          // the current content: toggling off cleanly discards unsaved edits
          // and never leaves a stale value shown as if it were the diff.
          key={`${appId}:${selected.path}:${editMode}`}
          filePath={selected.path}
          oldContent={selected.oldContent}
          newContent={selected.newContent}
          editable={editMode && selectedContentEditable}
          appId={appId}
          targetBranchName={writableBranchName}
          expectedBranchTipOid={expectedBranchTipOid}
          restartOnSwitchedToMainBranch={restartOnSwitchedToMainBranch}
        />
      </div>
    </div>
  );
}
