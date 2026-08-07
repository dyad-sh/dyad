import { useState, useEffect, useRef } from "react";
import { FileWarning, TriangleAlert } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  commitMessageDraftAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  releaseCommitDialogAtom,
} from "@/atoms/commitAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { useDiscardChanges } from "@/hooks/useDiscardChanges";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { generateDefaultCommitMessage } from "@/components/chat/uncommittedFileStatus";
import { CommitFileList } from "@/components/chat/CommitFileList";

interface UncommittedFilesBannerProps {
  appId: number | null;
}

export function UncommittedFilesBanner({ appId }: UncommittedFilesBannerProps) {
  const { uncommittedFiles, hasUncommittedFiles, isLoading } =
    useUncommittedFiles(appId);
  const { commitChanges, isCommitting } = useCommitChanges();
  const { discardChanges, isDiscarding } = useDiscardChanges();
  const { send: sendPreviewEvent } = useVersionPreview(appId);
  const [openCommitDialog, setOpenCommitDialog] = useAtom(openCommitDialogAtom);
  const openStagedDiffFile = useSetAtom(openStagedDiffAtom);
  const releaseCommitDialog = useSetAtom(releaseCommitDialogAtom);
  const commitMessageDraft = useAtomValue(commitMessageDraftAtom);
  const setCommitMessageDraft = useSetAtom(commitMessageDraftAtom);
  // Frozen at open so polling doesn't rewrite the suggestion under the user.
  // Only ever a suggestion: once the user types, the draft atom takes over.
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const confirmPanelRef = useRef<HTMLDivElement>(null);
  const canShowBanner = Boolean(appId) && !isLoading && !!hasUncommittedFiles;
  const isDialogOpen = openCommitDialog === "banner";
  // Read only at the moment the dialog opens, so the freeze above is against a
  // ref rather than a render-time dependency that would refresh with polling.
  const uncommittedFilesRef = useRef(uncommittedFiles);
  uncommittedFilesRef.current = uncommittedFiles;

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
  // return to one) cannot pop open unprompted on the next remount.
  useEffect(() => {
    if (!canShowBanner) {
      releaseCommitDialog("banner");
      return;
    }
    return () => releaseCommitDialog("banner");
  }, [canShowBanner, releaseCommitDialog]);

  // Refresh the suggestion on every open and drop it on close. The reopen after
  // leaving the staged diff comes straight from the atom rather than the button
  // handler, so freezing it there would commit a file list the user never saw.
  useEffect(() => {
    setGeneratedMessage(
      isDialogOpen
        ? generateDefaultCommitMessage(uncommittedFilesRef.current)
        : null,
    );
  }, [isDialogOpen]);

  if (!canShowBanner) {
    return null;
  }

  const commitMessage =
    commitMessageDraft ??
    generatedMessage ??
    generateDefaultCommitMessage(uncommittedFiles);

  // Dismissing without committing abandons the message: keeping it would
  // prefill a later, unrelated commit with text written for a change set that
  // has since moved on. The staged-diff round trip closes the dialog through
  // openStagedDiffAtom instead, so the draft survives that.
  const dismissDialog = () => {
    setShowDiscardConfirm(false);
    setOpenCommitDialog(null);
    setCommitMessageDraft(null);
  };

  // The diff renders in the code panel, which this banner's dialog has to
  // reveal. Any selected version diff must close first, since CodeView
  // suppresses staged-diff mode whenever one is active.
  const openStagedDiff = (filePath: string) => {
    sendPreviewEvent({ type: "CLOSE" });
    setShowDiscardConfirm(false);
    openStagedDiffFile({ path: filePath, returnTo: "banner" });
  };

  const handleCommit = async () => {
    if (!appId || !commitMessage.trim()) return;

    await commitChanges({ appId, message: commitMessage.trim() });
    setShowDiscardConfirm(false);
    setOpenCommitDialog(null);
    setCommitMessageDraft(null);
  };

  const handleDiscard = async () => {
    if (!appId) return;

    await discardChanges({ appId });
    setShowDiscardConfirm(false);
    setOpenCommitDialog(null);
    setCommitMessageDraft(null);
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
          onClick={() => setOpenCommitDialog("banner")}
          data-testid="review-commit-button"
        >
          Review & commit
        </Button>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setOpenCommitDialog("banner");
            return;
          }
          // Prevent closing while committing or discarding
          if (isCommitting || isDiscarding) return;
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
                onChange={(e) => setCommitMessageDraft(e.target.value)}
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
                disabled={isCommitting || isDiscarding}
                testId="changed-files-list"
              />
            </div>
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
                    disabled={isDiscarding}
                    data-testid="confirm-discard-button"
                  >
                    {isDiscarding ? "Discarding..." : "Yes, discard all"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDiscardConfirm(false)}
                    disabled={isDiscarding}
                  >
                    Keep changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 pb-6 pt-2">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
              onClick={() => setShowDiscardConfirm(true)}
              disabled={isCommitting || isDiscarding || showDiscardConfirm}
              data-testid="discard-button"
            >
              Discard all
            </Button>
            <Button
              variant="outline"
              onClick={dismissDialog}
              disabled={isCommitting || isDiscarding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting || isDiscarding}
              data-testid="commit-button"
            >
              {isCommitting ? "Committing..." : "Commit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
