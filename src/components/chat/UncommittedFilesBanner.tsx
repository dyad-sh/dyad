import { useState, useEffect, useRef, useCallback } from "react";
import { FileWarning, TriangleAlert } from "lucide-react";
import { useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  clearStagedDiffAtom,
  closeCommitDialogAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
} from "@/atoms/commitAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitMessage } from "@/hooks/useCommitMessage";
import { useDiscardChanges } from "@/hooks/useDiscardChanges";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { CommitFileList } from "@/components/chat/CommitFileList";
import { useCommitDialogRecovery } from "@/hooks/useCommitDialogRecovery";
import {
  CommitDialogFooter,
  CommitRecoveryAlerts,
} from "@/components/chat/CommitDialogActions";

interface UncommittedFilesBannerProps {
  appId: number | null;
}

export function UncommittedFilesBanner({ appId }: UncommittedFilesBannerProps) {
  const { uncommittedFiles, hasUncommittedFiles, isLoading } =
    useUncommittedFiles(appId);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const onDialogEnded = useCallback(() => setShowDiscardConfirm(false), []);
  const { isDialogOpen, commitMessage, setCommitMessage } = useCommitMessage(
    "banner",
    appId,
    uncommittedFiles,
  );
  const {
    cancelCommit,
    isCommitting,
    isCancellingCommit,
    commitProgress,
    preCommitError,
    prepareCommitMsgError,
    commitMsgError,
    resetCommitError,
    dismissDialog,
    handleCommit,
    handleFixPreCommitWithAI,
    isStartingAiFix,
    canFixPreCommitWithAI,
  } = useCommitDialogRecovery({
    appId: appId ?? -1,
    source: "banner",
    commitMessage,
    onDialogEnded,
  });
  const { discardChanges, isDiscarding } = useDiscardChanges();
  const { send: sendPreviewEvent } = useVersionPreview(appId);
  const setOpenCommitDialog = useSetAtom(openCommitDialogAtom);
  const openStagedDiffFile = useSetAtom(openStagedDiffAtom);
  const closeCommitDialog = useSetAtom(closeCommitDialogAtom);
  const clearStagedDiff = useSetAtom(clearStagedDiffAtom);
  const confirmPanelRef = useRef<HTMLDivElement>(null);
  const canShowBanner = appId !== null && !isLoading && !!hasUncommittedFiles;

  useEffect(() => {
    if (showDiscardConfirm) {
      confirmPanelRef.current
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="confirm-discard-button"]',
        )
        ?.focus();
    }
  }, [showDiscardConfirm]);

  // The dialog lives in a global atom but is rendered here, and this banner is
  // mounted conditionally - ChatHeader hides it while streaming and behind the
  // version pane, and it renders nothing without uncommitted files. Hand the
  // state back whenever it cannot be shown, so a dialog left open (or a pending
  // return to one) cannot pop open unprompted on the next remount, and the
  // message typed into it does not sit around to prefill a later commit.
  useEffect(() => {
    if (appId === null) return;
    if (!canShowBanner) {
      closeCommitDialog({ source: "banner", appId });
      return;
    }
    return () => closeCommitDialog({ source: "banner", appId });
  }, [canShowBanner, closeCommitDialog, appId]);

  if (!canShowBanner || appId === null) {
    return null;
  }

  // Dismissing without committing abandons the message: keeping it would
  // prefill a later, unrelated commit with text written for a change set that
  // has since moved on. It also drops any pending return to this dialog, so the
  // staged diff's back arrow cannot resurrect the dialog just dismissed. The
  // round trip out to a diff closes the dialog through openStagedDiffAtom
  // instead, so the draft survives that.
  // The diff renders in the code panel, which this banner's dialog has to
  // reveal. Any selected version diff must close first, since CodeView
  // suppresses staged-diff mode whenever one is active.
  const openStagedDiff = (filePath: string) => {
    sendPreviewEvent({ type: "CLOSE" });
    setShowDiscardConfirm(false);
    openStagedDiffFile({
      path: filePath,
      returnTo: { source: "banner", appId },
    });
  };

  const handleDiscard = async () => {
    try {
      await discardChanges({ appId });
    } catch {
      // useDiscardChanges surfaces the error via a toast; leave the dialog up.
      return;
    }
    setShowDiscardConfirm(false);
    closeCommitDialog({ source: "banner", appId });
    clearStagedDiff(appId);
  };

  return (
    <>
      <div
        className="flex flex-col @sm:flex-row items-center justify-between px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
        data-testid="uncommitted-files-banner"
      >
        <div className="flex items-center gap-2 text-sm">
          <FileWarning size={16} />
          <span>
            You have <strong>{uncommittedFiles.length}</strong> uncommitted{" "}
            {uncommittedFiles.length === 1 ? "change" : "changes"}.
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetCommitError();
            setOpenCommitDialog({ source: "banner", appId });
          }}
          data-testid="review-commit-button"
        >
          Review & commit
        </Button>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setOpenCommitDialog({ source: "banner", appId });
            return;
          }
          // Prevent closing while committing or discarding
          if (isCommitting || isDiscarding || isStartingAiFix) return;
          dismissDialog();
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden p-0"
          data-testid="commit-dialog"
        >
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Review & Commit Changes</DialogTitle>
            <DialogDescription>
              Review your changes and enter a commit message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <label
                htmlFor="commit-message"
                className="text-sm font-medium mb-2 block"
              >
                Commit message
              </label>
              <Input
                id="commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Enter commit message..."
                data-testid="commit-message-input"
              />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                Changed files ({uncommittedFiles.length})
              </p>
              <CommitFileList
                files={uncommittedFiles}
                onSelectFile={openStagedDiff}
                disabled={isCommitting || isDiscarding || isStartingAiFix}
                testId="changed-files-list"
              />
            </div>

            <CommitRecoveryAlerts
              preCommitError={preCommitError}
              prepareCommitMsgError={prepareCommitMsgError}
              commitMsgError={commitMsgError}
              isStartingAiFix={isStartingAiFix}
              canFixPreCommitWithAI={canFixPreCommitWithAI}
              onFixPreCommitWithAI={() => void handleFixPreCommitWithAI()}
            />
          </div>

          {showDiscardConfirm && (
            <div
              ref={confirmPanelRef}
              role="alertdialog"
              aria-labelledby="discard-confirm-title"
              aria-describedby="discard-confirm-desc"
              className="mx-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
            >
              <TriangleAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p
                  id="discard-confirm-title"
                  className="text-sm text-destructive font-medium"
                >
                  Discard changes to {uncommittedFiles.length}{" "}
                  {uncommittedFiles.length === 1 ? "file" : "files"}?{" "}
                  <span id="discard-confirm-desc">This cannot be undone.</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDiscard}
                    disabled={isDiscarding || isStartingAiFix}
                    data-testid="confirm-discard-button"
                  >
                    {isDiscarding ? "Discarding..." : "Yes, discard all"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDiscardConfirm(false)}
                    disabled={isDiscarding || isStartingAiFix}
                  >
                    Keep changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 pb-6 pt-2">
            <CommitDialogFooter
              leadingAction={
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
                  onClick={() => setShowDiscardConfirm(true)}
                  disabled={
                    isCommitting ||
                    isDiscarding ||
                    isStartingAiFix ||
                    showDiscardConfirm
                  }
                  data-testid="discard-button"
                >
                  Discard all
                </Button>
              }
              isCommitting={isCommitting}
              isCancellingCommit={isCancellingCommit}
              phase={commitProgress?.phase ?? null}
              isBusy={isDiscarding || isStartingAiFix}
              commitDisabled={!commitMessage.trim()}
              commitButtonTestId="commit-button"
              onDismiss={dismissDialog}
              onCancelCommit={() => void cancelCommit()}
              onCommit={() => void handleCommit()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
