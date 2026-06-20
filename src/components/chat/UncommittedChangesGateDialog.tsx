import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { uncommittedChangesGateAtom } from "@/atoms/uncommittedChangesGateAtom";
import { UncommittedChangesReview } from "./UncommittedChangesReview";
import { generateDefaultCommitMessage } from "./uncommitted-files-utils";

/**
 * App-wide dialog that blocks a revert when the worktree is dirty, letting the
 * user choose to commit or discard their changes first. Driven entirely by
 * {@link uncommittedChangesGateAtom} (opened by `useVersions`), so a single mount
 * covers every revert entry point. Mounted once in `ChatPanel`.
 *
 * The dialog only collects the user's choice; the actual commit/discard is
 * performed on `main` by the revert handler (see version_handlers `revertVersion`).
 */
export function UncommittedChangesGateDialog() {
  const [gate] = useAtom(uncommittedChangesGateAtom);
  const appId = gate.appId;
  const { uncommittedFiles } = useUncommittedFiles(appId);
  const [commitMessage, setCommitMessage] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Seed the default commit message once per open session, as soon as the file
  // list is available, without clobbering the user's edits on later polls.
  const seededRef = useRef(false);

  useEffect(() => {
    if (!gate.open) {
      seededRef.current = false;
      setShowDiscardConfirm(false);
      return;
    }
    if (!seededRef.current && uncommittedFiles.length > 0) {
      setCommitMessage(generateDefaultCommitMessage(uncommittedFiles));
      seededRef.current = true;
    }
  }, [gate.open, uncommittedFiles]);

  const handleCommit = () => {
    if (!commitMessage.trim()) return;
    gate.onResolve?.({ action: "commit", commitMessage: commitMessage.trim() });
  };

  const handleDiscard = () => {
    gate.onResolve?.({ action: "discard" });
  };

  const handleCancel = () => {
    gate.onCancel?.();
  };

  return (
    <Dialog
      open={gate.open}
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden p-0"
        data-testid="uncommitted-changes-gate-dialog"
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Uncommitted changes</DialogTitle>
          <DialogDescription>
            You have uncommitted changes. Commit or discard them before
            restoring this version.
          </DialogDescription>
        </DialogHeader>

        <UncommittedChangesReview
          files={uncommittedFiles}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onCommit={handleCommit}
          onDiscard={handleDiscard}
          onCancel={handleCancel}
          isCommitting={false}
          isDiscarding={false}
          showDiscardConfirm={showDiscardConfirm}
          onShowDiscardConfirm={setShowDiscardConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}
