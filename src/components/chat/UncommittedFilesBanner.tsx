import { useState } from "react";
import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { useDiscardChanges } from "@/hooks/useDiscardChanges";
import { UncommittedChangesReview } from "./UncommittedChangesReview";
import { generateDefaultCommitMessage } from "./uncommitted-files-utils";

interface UncommittedFilesBannerProps {
  appId: number | null;
}

export function UncommittedFilesBanner({ appId }: UncommittedFilesBannerProps) {
  const { uncommittedFiles, hasUncommittedFiles, isLoading } =
    useUncommittedFiles(appId);
  const { commitChanges, isCommitting } = useCommitChanges();
  const { discardChanges, isDiscarding } = useDiscardChanges();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  if (!appId || isLoading || !hasUncommittedFiles) {
    return null;
  }

  const handleOpenDialog = () => {
    // Set default commit message only when opening the dialog
    // This prevents overwriting user's custom message during polling
    setCommitMessage(generateDefaultCommitMessage(uncommittedFiles));
    setIsDialogOpen(true);
  };

  const handleCommit = async () => {
    if (!appId || !commitMessage.trim()) return;

    await commitChanges({ appId, message: commitMessage.trim() });
    setShowDiscardConfirm(false);
    setIsDialogOpen(false);
    setCommitMessage("");
  };

  const handleDiscard = async () => {
    if (!appId) return;

    await discardChanges({ appId });
    setShowDiscardConfirm(false);
    setIsDialogOpen(false);
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
          onClick={handleOpenDialog}
          data-testid="review-commit-button"
        >
          Review & commit
        </Button>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          // Prevent closing while committing or discarding
          if (!open && (isCommitting || isDiscarding)) return;
          if (!open) setShowDiscardConfirm(false);
          setIsDialogOpen(open);
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

          <UncommittedChangesReview
            files={uncommittedFiles}
            commitMessage={commitMessage}
            onCommitMessageChange={setCommitMessage}
            onCommit={handleCommit}
            onDiscard={handleDiscard}
            onCancel={() => setIsDialogOpen(false)}
            isCommitting={isCommitting}
            isDiscarding={isDiscarding}
            showDiscardConfirm={showDiscardConfirm}
            onShowDiscardConfirm={setShowDiscardConfirm}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
