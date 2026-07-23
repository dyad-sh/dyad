import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { useEffect, useState } from "react";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  RefreshCw,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Pencil,
  Save,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedFileAtom,
  stagedDiffFileAtom,
  diffEditModeAtom,
  diffDirtyAtom,
  diffSavingAtom,
  diffContentEditableAtom,
  diffSaveRequestAtom,
} from "@/atoms/viewAtoms";
import { useTranslation } from "react-i18next";
import { VersionDiffView } from "./VersionDiffView";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { StagedDiffView } from "./StagedDiffView";
import { CommitMenu } from "./CommitMenu";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { diffVersionIdForState } from "@/version_preview/state";
import { useWritableVersionTip } from "@/hooks/useWritableVersionTip";

interface App {
  id?: number;
  files?: string[];
  neonProjectId?: string | null;
}

export interface CodeViewProps {
  loading: boolean;
  app: App | null;
}

// Code view component that displays app files or status messages
export const CodeView = ({ loading, app }: CodeViewProps) => {
  const { t } = useTranslation("home");
  const selectedFile = useAtomValue(selectedFileAtom);
  const { state: previewState, send: sendPreviewEvent } = useVersionPreview(
    app?.id ?? null,
  );
  const selectedVersionId = diffVersionIdForState(previewState);
  const stagedDiffFile = useAtomValue(stagedDiffFileAtom);
  const setStagedDiffFile = useSetAtom(stagedDiffFileAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const { hasUncommittedFiles } = useUncommittedFiles(app?.id ?? null);

  const isEditingDiff = useAtomValue(diffEditModeAtom);
  const diffDirty = useAtomValue(diffDirtyAtom);
  const diffSaving = useAtomValue(diffSavingAtom);
  const diffContentEditable = useAtomValue(diffContentEditableAtom);
  const setIsEditingDiff = useSetAtom(diffEditModeAtom);
  const setDiffDirty = useSetAtom(diffDirtyAtom);
  const setDiffSaving = useSetAtom(diffSavingAtom);
  const setDiffContentEditable = useSetAtom(diffContentEditableAtom);
  const setDiffSaveRequest = useSetAtom(diffSaveRequestAtom);

  const isVersionDiffMode = selectedVersionId != null && app?.id != null;
  const isStagedDiffMode =
    stagedDiffFile != null && app?.id != null && !isVersionDiffMode;
  const inDiffMode = isVersionDiffMode || isStagedDiffMode;

  // The branch (and its tip commit) a version-diff edit would be written to.
  // Editing a version diff is only allowed when the version being shown *is*
  // the writable branch tip, so that saving lands as a new version on top of
  // the branch rather than on a detached historical commit.
  const { writableBranch, writableTipOid } = useWritableVersionTip({
    appId: app?.id ?? null,
    previewState,
    enabled: isVersionDiffMode,
  });

  const baseCanEditDiff =
    isStagedDiffMode ||
    (isVersionDiffMode &&
      writableTipOid != null &&
      selectedVersionId === writableTipOid);
  const canEditDiff = baseCanEditDiff && diffContentEditable;

  const toggleDiffEditing = () => {
    if (!canEditDiff) {
      return;
    }
    if (isEditingDiff) {
      // Leaving edit mode discards any in-editor edits that weren't saved.
      setIsEditingDiff(false);
      setDiffDirty(false);
      setDiffSaving(false);
    } else {
      setIsEditingDiff(true);
    }
  };

  // Reset edit-in-diff state whenever we leave diff mode by any path (the back
  // button, closing the version diff, switching apps) or the current diff stops
  // being editable, and on unmount, so it never leaks into a later diff.
  useEffect(() => {
    if (!inDiffMode || !canEditDiff) {
      setIsEditingDiff(false);
      setDiffDirty(false);
      setDiffSaving(false);
    }
    if (!inDiffMode) {
      setDiffContentEditable(true);
    }
  }, [
    inDiffMode,
    canEditDiff,
    setIsEditingDiff,
    setDiffDirty,
    setDiffSaving,
    setDiffContentEditable,
  ]);
  useEffect(
    () => () => {
      setIsEditingDiff(false);
      setDiffDirty(false);
      setDiffSaving(false);
      setDiffContentEditable(true);
    },
    [setIsEditingDiff, setDiffDirty, setDiffSaving, setDiffContentEditable],
  );

  // Exits version-diff mode (entered via the version history pane or the chat's
  // modified-files card) and returns to the live file tree. Without this the
  // Code tab would stay pinned to a commit diff with no in-context way back.
  const closeVersionDiff = () => {
    sendPreviewEvent({ type: "CLOSE_VERSION_DIFF" });
  };
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  if (loading) {
    return <div className="text-center py-4">{t("preview.loadingFiles")}</div>;
  }

  if (!app) {
    return (
      <div className="text-center py-4 text-gray-500">
        {t("preview.noAppSelected")}
      </div>
    );
  }

  // The version diff view is driven by the selected commit, not the current
  // working-tree files, so it must render even when the checkout has no files
  // (e.g. a deletion-only version or an otherwise empty working tree).
  // Likewise, render the toolbar (and its Commit menu) whenever there are
  // uncommitted changes, so deletion-only staged changes remain committable
  // even if no files are left to list.
  if (
    isVersionDiffMode ||
    isStagedDiffMode ||
    (app.files && app.files.length > 0) ||
    (app.id != null && hasUncommittedFiles)
  ) {
    return (
      <div
        className={`flex flex-col bg-background ${isFullscreen ? "fixed inset-0 z-50 h-screen w-screen shadow-2xl" : "h-full"}`}
      >
        {/* Toolbar */}
        <div className="flex items-center p-2 border-b space-x-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => refreshApp()}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading || !app.id}
                />
              }
            >
              <RefreshCw size={16} />
            </TooltipTrigger>
            <TooltipContent>{t("preview.refreshFiles")}</TooltipContent>
          </Tooltip>
          {isStagedDiffMode && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setStagedDiffFile(null)}
                    aria-label={t("preview.backToEditor")}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    data-testid="staged-diff-back-button"
                  />
                }
              >
                <ArrowLeft size={16} />
              </TooltipTrigger>
              <TooltipContent>{t("preview.backToEditor")}</TooltipContent>
            </Tooltip>
          )}
          {isVersionDiffMode && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    data-testid="close-version-diff"
                    onClick={closeVersionDiff}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  />
                }
              >
                <ArrowLeft size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {t("preview.closeVersionChanges")}
              </TooltipContent>
            </Tooltip>
          )}
          <div className="text-sm text-gray-500">
            {isVersionDiffMode
              ? t("preview.viewingVersionChanges")
              : isStagedDiffMode
                ? t("preview.viewingStagedChanges")
                : `${app.files?.length ?? 0} ${t("preview.files")}`}
          </div>
          <div className="flex-1" />
          {canEditDiff && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={toggleDiffEditing}
                      aria-pressed={isEditingDiff}
                      aria-label={
                        isEditingDiff
                          ? t("preview.stopEditing")
                          : t("preview.editFile")
                      }
                      data-testid="diff-edit-toggle"
                      className={cn(
                        "p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700",
                        isEditingDiff && "bg-gray-200 dark:bg-gray-700",
                      )}
                    />
                  }
                >
                  <Pencil size={16} />
                </TooltipTrigger>
                <TooltipContent>
                  {isEditingDiff
                    ? t("preview.stopEditing")
                    : t("preview.editFile")}
                </TooltipContent>
              </Tooltip>
              {isEditingDiff && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setDiffSaveRequest((n) => n + 1)}
                        disabled={!diffDirty || diffSaving}
                        aria-label={t("preview.saveChanges")}
                        data-testid="diff-save-button"
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    }
                  >
                    <Save size={16} />
                  </TooltipTrigger>
                  <TooltipContent>{t("preview.saveChanges")}</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
          {app.id != null && <CommitMenu appId={app.id} />}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setIsFullscreen((value) => !value)}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                />
              }
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </TooltipTrigger>
            <TooltipContent>
              {isFullscreen
                ? t("preview.exitFullScreen")
                : t("preview.enterFullScreen")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        {isVersionDiffMode ? (
          <VersionDiffView
            appId={app.id!}
            versionId={selectedVersionId}
            writableBranchName={
              canEditDiff ? (writableBranch ?? undefined) : undefined
            }
            expectedBranchTipOid={
              canEditDiff ? (writableTipOid ?? undefined) : undefined
            }
            restartOnSwitchedToMainBranch={!!app.neonProjectId}
          />
        ) : isStagedDiffMode ? (
          <StagedDiffView
            appId={app.id!}
            restartOnSwitchedToMainBranch={!!app.neonProjectId}
          />
        ) : (
          <PanelGroup
            direction="horizontal"
            autoSaveId="code-view-file-tree"
            className="flex-1 overflow-hidden"
          >
            <Panel defaultSize={33} minSize={15}>
              <div className="h-full overflow-hidden flex flex-col min-h-0">
                <FileTree appId={app.id ?? null} files={app.files ?? []} />
              </div>
            </Panel>
            <PanelResizeHandle
              aria-label="Resize file tree"
              className="w-1 bg-border hover:bg-gray-400 transition-colors cursor-col-resize"
            />
            <Panel defaultSize={67} minSize={30}>
              {selectedFile ? (
                <FileEditor
                  key={`${app.id ?? "unknown"}:${selectedFile.path}`}
                  appId={app.id ?? null}
                  filePath={selectedFile.path}
                  initialLine={selectedFile.line ?? null}
                />
              ) : (
                <div className="text-center py-4 text-gray-500">
                  {t("preview.selectFileToView")}
                </div>
              )}
            </Panel>
          </PanelGroup>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-4 text-gray-500">
      {t("preview.noFilesFound")}
    </div>
  );
};
