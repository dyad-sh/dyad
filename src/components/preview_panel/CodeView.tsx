import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  RefreshCw,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Pencil,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { clearStagedDiffAtom, exitStagedDiffAtom } from "@/atoms/commitAtoms";
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
import { showWarning } from "@/lib/toast";

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
    getState: getPreviewState,
  } = useVersionPreview(app?.id ?? null);
  const queryClient = useQueryClient();
  const selectedVersionId = diffVersionIdForState(previewState);
  const stagedDiffFile = useAtomValue(stagedDiffFileAtom);
  const exitStagedDiff = useSetAtom(exitStagedDiffAtom);
  const clearStagedDiff = useSetAtom(clearStagedDiffAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const { uncommittedFiles, hasUncommittedFiles } = useUncommittedFiles(
    app?.id ?? null,
  );
  const { changes: versionChanges } = useVersionChanges(
    app?.id ?? null,
    selectedVersionId,
  );

  const closeVersionDiff = () => {
    sendPreviewEvent({ type: "CLOSE_VERSION_DIFF" });
  };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLeavingHistoricalCheckout, setIsLeavingHistoricalCheckout] =
    useState(false);
  // An edit attempt gave up while the app was still on the previewed commit -
  // the return failed, or another window kept the checkout alive. The working
  // tree stays historical until that is resolved, so the file tree must stay
  // closed rather than offer the previewed commit's files for editing.
  const [editLeftAppDetached, setEditLeftAppDetached] = useState(false);
  // Which app the panel is showing right now. Returning to the origin branch is
  // async, so the user can switch apps mid-flight; the continuation compares
  // against this to avoid applying the edit to whatever app took its place.
  const displayedAppIdRef = useRef(app?.id ?? null);
  // Whether the app owned a historical checkout as of the last settled render,
  // so the effect below can tell "the checkout was released" apart from "the
  // flag was just raised against a checkout React has not rendered yet".
  const ownedHistoricalCheckoutRef = useRef(
    ownsHistoricalCheckout(previewState),
  );
  // Leaving Code mode tears the panel down without running the app-id effect,
  // so displayedAppIdRef would keep answering for an app that is no longer
  // displayed. The file selection it writes is global, so an unmounted panel
  // must not commit one: a later app could render the editor with this app's
  // path and overwrite the wrong file on save.
  const isMountedRef = useRef(true);

  // Layout, not passive: both bookkeeping effects answer for "what is displayed
  // right now" on behalf of an in-flight edit, and a passive effect is flushed
  // in a separate task after the commit. An awaited step of the edit can settle
  // inside that window - the new app (or nothing) is already on screen, yet the
  // refs still describe the old one, so isEditStillDisplayed says yes and the
  // continuation writes the previous app's path into the global selection.
  // Layout effects run synchronously inside the commit, which no promise
  // continuation can interleave with, so the window does not exist.
  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    displayedAppIdRef.current = app?.id ?? null;
    // Both flags describe the app that was displayed when the edit was
    // attempted, so they say nothing about the one that replaced it. Without
    // this, the new app shows the returning spinner and a disabled pencil for
    // an operation it is not performing.
    setEditLeftAppDetached(false);
    setIsLeavingHistoricalCheckout(false);
  }, [app?.id]);

  // The flag describes one specific detached checkout - the one the edit
  // attempt could not get the app off. Once that checkout is released (the
  // other window closed its preview, or a recovery retry succeeded) the
  // statement is no longer true, and a later preview of the same app would
  // otherwise inherit it and claim another window is holding a checkout this
  // window owns. Clear on the falling edge of ownership rather than on every
  // unowned render: the second guard in the edit continuation raises the flag
  // against a checkout another window has just started, which React may not
  // have rendered yet, and that flag must survive.
  useEffect(() => {
    const ownsCheckout = ownsHistoricalCheckout(previewState);
    if (ownedHistoricalCheckoutRef.current && !ownsCheckout) {
      setEditLeftAppDetached(false);
    }
    ownedHistoricalCheckoutRef.current = ownsCheckout;
  }, [previewState]);

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
    (ownsHistoricalCheckout(previewState)
      ? // The working tree - and so app.files - is the previewed commit's here,
        // and cannot say whether the origin branch still has the file. Only the
        // version-diff path returns to the branch before opening the editor, so
        // it is the only one that may defer the existence check to the
        // post-return re-list; a staged diff would open the detached copy.
        isVersionDiffMode
      : app.files?.includes(displayedDiffPath) === true) &&
    // A Git mutation is in flight (checkout, return, restore, branch switch):
    // which commit the editor would open is undecided until it settles.
    !isMutatingState(previewState) &&
    !isLeavingHistoricalCheckout;
  const editDisabledReason = canEditDisplayedDiff
    ? null
    : displayedDiffPath == null
      ? t("preview.editDisabledNoFile")
      : isLeavingHistoricalCheckout || isMutatingState(previewState)
        ? t("preview.editDisabledBusy")
        : ownsHistoricalCheckout(previewState)
          ? t("preview.editDisabledHistoricalCheckout")
          : t("preview.editDisabledMissingAtLatest");
  // Returning to the origin branch is async, and until it settles the working
  // tree - and therefore app.files - is still the previewed commit's. The
  // machine has already dropped the diff presentation by then, so rendering the
  // file tree here would invite the user to open, and save over, historical
  // files.
  const isReturningToLatestVersion =
    isLeavingHistoricalCheckout || previewState.type === "returning";
  // Same hazard once the machine has given up: a failed return or an
  // interrupted restore leaves the app detached until the recovery
  // notification's retry succeeds, and an edit that bailed out because another
  // window kept the checkout stays detached until that window releases it.
  // Only the first has a retry to point the user at.
  const isAwaitingCheckoutRecovery =
    previewState.type === "recovery-required" ||
    previewState.type === "restore-recovery-required";
  const isStuckOnHistoricalCheckout =
    (isAwaitingCheckoutRecovery || editLeftAppDetached) &&
    ownsHistoricalCheckout(previewState);

  // An edit that outlived the view that started it must not touch state that
  // belongs to whatever is displayed now - another app, or nothing at all.
  const isEditStillDisplayed = (appId: number | undefined) =>
    isMountedRef.current && displayedAppIdRef.current === appId;

  // Previewing a version checks the app out at that commit (detached HEAD), so
  // opening the editor there would show - and save over - the historical copy.
  // Return to the origin branch first, then open the branch's latest version.
  const editAfterLeavingHistoricalCheckout = async (path: string) => {
    const appId = app.id;
    // Closing the diff is immediate while the git return is not, so any file
    // already open would render the detached working tree's copy in the gap.
    // Re-select only once the branch is back and the target is confirmed.
    setSelectedFile(null);
    await sendPreviewEventAndWait({ type: "CLOSE" });
    // The user moved on - to another app, or out of Code mode entirely - while
    // the return was in flight. Whatever is displayed next must not inherit
    // this app's file selection.
    if (!isEditStillDisplayed(appId)) return;
    if (appId != null) {
      // Content cached while detached describes the historical commit, so drop
      // it rather than briefly showing it as the file's latest version.
      queryClient.removeQueries({
        queryKey: queryKeys.appFiles.content({ appId, filePath: path }),
      });
    }
    // CLOSE resolves without running the git return when this window was not
    // the last one interested in the preview, so a settled promise is not proof
    // the checkout was released. Read the machine directly (React may not have
    // re-rendered yet) and bail out rather than edit the historical copy.
    if (ownsHistoricalCheckout(getPreviewState())) {
      setEditLeftAppDetached(true);
      showWarning(t("preview.editLatestVersionUnavailable", { path }));
      return;
    }
    // While detached, app.files listed the previewed commit's working tree, so
    // the button's existence guard could not speak for the origin branch. Now
    // that the branch is checked out again, re-list and confirm the file is
    // still there: a file that only exists in the previewed version would
    // otherwise open an empty editor that re-creates it on save.
    const refreshed = await refreshApp();
    if (!isEditStillDisplayed(appId)) return;
    // Another window can start previewing a version while the re-list is in
    // flight, so the check above no longer speaks for the current checkout -
    // and the listing may already describe the newly detached tree. Confirm
    // ownership again before committing to opening the editor.
    if (ownsHistoricalCheckout(getPreviewState())) {
      setEditLeftAppDetached(true);
      showWarning(t("preview.editLatestVersionUnavailable", { path }));
      return;
    }
    // refetch() resolves with the last-good (detached) listing when it fails,
    // so an errored re-list cannot confirm anything and must not open the file.
    const latestFiles = refreshed.isError ? undefined : refreshed.data?.files;
    if (!latestFiles) {
      showWarning(t("preview.editLatestVersionUnavailable", { path }));
      return;
    }
    if (!latestFiles.includes(path)) {
      showWarning(t("preview.editLatestVersionMissing", { path }));
      return;
    }
    setSelectedFile({ path });
  };

  const editDisplayedDiff = () => {
    if (!displayedDiffPath || !canEditDisplayedDiff) return;
    const path = displayedDiffPath;
    // A staged selection left over from before the version diff opened would
    // put the panel back in staged-diff mode instead of the editor, so clear it
    // on every path out of here. The user asked for the editor, so this must
    // not reopen a commit dialog on top of it, nor keep the message they were
    // typing in one.
    clearStagedDiff(app?.id ?? null);

    if (!isVersionDiffMode) {
      setSelectedFile({ path });
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

    const appId = app.id;
    setIsLeavingHistoricalCheckout(true);
    setEditLeftAppDetached(false);
    void editAfterLeavingHistoricalCheckout(path)
      // Returning to the branch failed: the app is still detached, so keep the
      // file tree closed instead of offering the historical copy for editing.
      // The failed return surfaces its own recovery notification.
      .catch(() => {
        if (!isEditStillDisplayed(appId)) return;
        setEditLeftAppDetached(true);
      })
      // A settlement that arrives after the panel moved on describes an
      // operation the displayed app is not running, so it must not clear (or
      // set) that app's edit state - the app-id effect already reset it.
      .finally(() => {
        if (!isEditStillDisplayed(appId)) return;
        setIsLeavingHistoricalCheckout(false);
      });
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
    isReturningToLatestVersion ||
    isStuckOnHistoricalCheckout ||
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
                    onClick={() => exitStagedDiff()}
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
          {!isVersionDiffMode && (
            <div className="text-sm text-gray-500">
              {isStagedDiffMode
                ? t("preview.viewingStagedChanges")
                : `${app.files?.length ?? 0} ${t("preview.files")}`}
            </div>
          )}
          <div className="flex-1" />
          {(isVersionDiffMode || isStagedDiffMode) && (
            <Tooltip>
              {/* A disabled <button> swallows pointer events, so the tooltip
                  that explains why editing is unavailable would never open if
                  the button were the trigger itself. */}
              <TooltipTrigger
                render={
                  <span
                    className={`inline-flex ${canEditDisplayedDiff ? "" : "cursor-not-allowed"}`}
                  />
                }
              >
                <button
                  type="button"
                  onClick={editDisplayedDiff}
                  disabled={!canEditDisplayedDiff}
                  aria-label={t("preview.editLatestVersion")}
                  data-testid="edit-latest-version-button"
                  data-disabled-reason={editDisabledReason ?? undefined}
                  aria-busy={isLeavingHistoricalCheckout}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {isLeavingHistoricalCheckout ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Pencil size={16} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {editDisabledReason ?? t("preview.editLatestVersion")}
              </TooltipContent>
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
        ) : isReturningToLatestVersion ? (
          <div
            data-testid="returning-to-latest-version"
            className="flex-1 flex items-center justify-center gap-2 py-4 text-sm text-gray-500"
          >
            <Loader2 size={16} className="animate-spin" />
            {t("preview.returningToLatestVersion")}
          </div>
        ) : isStuckOnHistoricalCheckout ? (
          <div
            data-testid="historical-checkout-not-released"
            className="flex-1 flex items-center justify-center px-4 py-4 text-center text-sm text-gray-500"
          >
            {isAwaitingCheckoutRecovery
              ? t("preview.historicalCheckoutNotReleased")
              : t("preview.historicalCheckoutHeldElsewhere")}
          </div>
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
