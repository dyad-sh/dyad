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
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { useTranslation } from "react-i18next";
import { VersionDiffView } from "./VersionDiffView";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { StagedDiffView } from "./StagedDiffView";
import { CommitMenu } from "./CommitMenu";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import {
  diffVersionIdForState,
  isMutatingState,
  ownsHistoricalCheckout,
  selectedDiffFileForState,
} from "@/version_preview/state";
import { useVersionChanges } from "@/hooks/useVersionChanges";
import {
  getDisplayedStagedDiffPath,
  getDisplayedVersionDiffPath,
} from "./diffSelection";

interface App {
  id?: number;
  files?: string[];
}

export interface CodeViewProps {
  loading: boolean;
  app: App | null;
}

// Code view component that displays app files or status messages
export const CodeView = ({ loading, app }: CodeViewProps) => {
  const { t } = useTranslation("home");
  const selectedFile = useAtomValue(selectedFileAtom);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const {
    state: previewState,
    send: sendPreviewEvent,
    sendAndWaitForMutation: sendPreviewEventAndWait,
  } = useVersionPreview(app?.id ?? null);
  const queryClient = useQueryClient();
  const selectedVersionId = diffVersionIdForState(previewState);
  const stagedDiffFile = useAtomValue(stagedDiffFileAtom);
  const setStagedDiffFile = useSetAtom(stagedDiffFileAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const { uncommittedFiles, hasUncommittedFiles } = useUncommittedFiles(
    app?.id ?? null,
  );
  const { changes: versionChanges } = useVersionChanges(
    app?.id ?? null,
    selectedVersionId,
  );

  // Exits version-diff mode (entered via the version history pane or the chat's
  // modified-files card) and returns to the live file tree. Without this the
  // Code tab would stay pinned to a commit diff with no in-context way back.
  const closeVersionDiff = () => {
    sendPreviewEvent({ type: "CLOSE_VERSION_DIFF" });
  };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLeavingHistoricalCheckout, setIsLeavingHistoricalCheckout] =
    useState(false);

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

  const isVersionDiffMode = selectedVersionId != null && app.id != null;
  const isStagedDiffMode =
    stagedDiffFile != null && app.id != null && !isVersionDiffMode;
  const selectedVersionDiffFile = selectedDiffFileForState(previewState);
  const displayedDiffPath = isVersionDiffMode
    ? getDisplayedVersionDiffPath(
        versionChanges,
        selectedVersionDiffFile?.versionId === selectedVersionId
          ? selectedVersionDiffFile.path
          : null,
      )
    : isStagedDiffMode
      ? getDisplayedStagedDiffPath(uncommittedFiles, stagedDiffFile)
      : null;
  const canEditDisplayedDiff =
    displayedDiffPath != null &&
    app.files?.includes(displayedDiffPath) === true &&
    // A Git mutation is in flight (checkout, return, restore, branch switch):
    // which commit the editor would open is undecided until it settles.
    !isMutatingState(previewState) &&
    !isLeavingHistoricalCheckout;

  // Previewing a version checks the app out at that commit (detached HEAD), so
  // opening the editor there would show - and save over - the historical copy.
  // Return to the origin branch first, then open the branch's latest version.
  const editAfterLeavingHistoricalCheckout = async (path: string) => {
    const appId = app.id;
    await sendPreviewEventAndWait({ type: "CLOSE" });
    if (appId != null) {
      // Content cached while detached describes the historical commit, so drop
      // it rather than briefly showing it as the file's latest version.
      queryClient.removeQueries({
        queryKey: queryKeys.appFiles.content({ appId, filePath: path }),
      });
    }
    setSelectedFile({ path });
  };

  const editDisplayedDiff = () => {
    if (!displayedDiffPath || !canEditDisplayedDiff) return;
    const path = displayedDiffPath;

    if (!isVersionDiffMode) {
      setSelectedFile({ path });
      setStagedDiffFile(null);
      return;
    }

    if (!ownsHistoricalCheckout(previewState)) {
      // Nothing is checked out historically (e.g. a diff opened from the chat's
      // modified-files card), so the working tree already holds the latest
      // files and closing the diff is enough.
      setSelectedFile({ path });
      closeVersionDiff();
      return;
    }

    setIsLeavingHistoricalCheckout(true);
    void editAfterLeavingHistoricalCheckout(path)
      // Returning to the branch failed: the app is still detached, so leave the
      // diff open instead of editing the historical copy. The failed return
      // surfaces its own recovery notification.
      .catch(() => undefined)
      .finally(() => setIsLeavingHistoricalCheckout(false));
  };

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
          {(isVersionDiffMode || isStagedDiffMode) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={editDisplayedDiff}
                    disabled={!canEditDisplayedDiff}
                    aria-label={t("preview.editLatestVersion")}
                    data-testid="edit-latest-version-button"
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                }
              >
                <Pencil size={16} />
              </TooltipTrigger>
              <TooltipContent>{t("preview.editLatestVersion")}</TooltipContent>
            </Tooltip>
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
          <VersionDiffView appId={app.id!} versionId={selectedVersionId} />
        ) : isStagedDiffMode ? (
          <StagedDiffView appId={app.id!} />
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
                  persistCursor
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
