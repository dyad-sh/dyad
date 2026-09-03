import { useEffect } from "react";
import { GitCommitVertical, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSetAtom } from "jotai";
import { Button, buttonVariants } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  closeCommitDialogAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  type CommitDialogOwner,
} from "@/atoms/commitAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitMessage } from "@/hooks/useCommitMessage";
import { cn } from "@/lib/utils";
import {
  getStatusIcon,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";
import { CommitFileList } from "@/components/chat/CommitFileList";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { useCommitDialogRecovery } from "@/hooks/useCommitDialogRecovery";
import {
  CommitDialogFooter,
  CommitRecoveryAlerts,
} from "@/components/chat/CommitDialogActions";

interface CommitMenuProps {
  appId: number;
}

/**
 * "Commit" button + a dropdown listing the staged (uncommitted) files at the
 * top of the code editor. Clicking a file opens its working-tree diff; clicking
 * Commit opens a confirmation dialog that commits all staged files at once.
 */
export function CommitMenu({ appId }: CommitMenuProps) {
  const { t } = useTranslation("home");
  const { uncommittedFiles, hasUncommittedFiles } = useUncommittedFiles(appId);
  const setOpenCommitDialog = useSetAtom(openCommitDialogAtom);
  const openStagedDiffFile = useSetAtom(openStagedDiffAtom);
  const closeCommitDialog = useSetAtom(closeCommitDialogAtom);
  const { send: sendPreviewEvent } = useVersionPreview(appId);
  const { isDialogOpen, commitMessage, setCommitMessage } = useCommitMessage(
    "editor",
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
    commitError,
    resetCommitError,
    dismissDialog,
    handleCommit,
    handleFixPreCommitWithAI,
    isStartingAiFix,
    isCheckingAiFixAvailability,
    aiFixUnavailableReason,
  } = useCommitDialogRecovery({
    appId,
    source: "editor",
    commitMessage,
  });

  // CodeView unmounts whenever previewMode leaves "code", and background
  // subscriptions change it on their own - usePlanEvents switches to plan mode
  // on every plan:update event. The dialog lives in a global atom, so without
  // this it would survive that unmount invisibly and pop back open the next
  // time the user returns to Code. The staged diff renders inside this same
  // toolbar's view, so the round trip out to a diff does not unmount us.
  useEffect(
    () => () => closeCommitDialog({ source: "editor", appId }),
    [closeCommitDialog, appId],
  );

  // Opening a staged file's diff must clear any selected version diff, since
  // CodeView suppresses staged-diff mode whenever a version diff is active.
  // `returnTo` is what brings the user back to the dialog they came from.
  const openStagedDiff = (
    filePath: string,
    returnTo: CommitDialogOwner | null,
  ) => {
    sendPreviewEvent({ type: "CLOSE" });
    openStagedDiffFile({ path: filePath, returnTo });
  };

  // Dismissing without committing abandons the message: keeping it would
  // prefill a later, unrelated commit with text written for a change set that
  // has since moved on. It also drops any pending return to this dialog, so the
  // staged diff's back arrow cannot resurrect the dialog just dismissed. The
  // round trip out to a diff closes the dialog through openStagedDiffAtom
  // instead, so the draft survives that.
  return (
    <div className="flex items-center" data-testid="commit-menu">
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none border-r-0"
        disabled={!hasUncommittedFiles}
        onClick={() => {
          resetCommitError();
          setOpenCommitDialog({ source: "editor", appId });
        }}
        data-testid="editor-commit-button"
      >
        <GitCommitVertical size={14} />
        {t("preview.commit")}
        {hasUncommittedFiles && (
          <span className="rounded-full bg-muted px-1.5 text-xs">
            {uncommittedFiles.length}
          </span>
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!hasUncommittedFiles}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "rounded-l-none px-1.5",
          )}
          aria-label={t("preview.stagedFiles")}
          data-testid="staged-files-trigger"
        >
          <ChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>
            {t("preview.stagedFilesWithCount", {
              count: uncommittedFiles.length,
            })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {uncommittedFiles.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">
              {t("preview.noStagedChanges")}
            </div>
          ) : (
            uncommittedFiles.map((file) => (
              <DropdownMenuItem
                key={file.path}
                className="flex items-center gap-2"
                // The dropdown is a shortcut straight to a diff, so leaving it
                // returns to the editor rather than opening the dialog.
                onClick={() => openStagedDiff(file.path, null)}
                data-testid="staged-file-item"
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
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setOpenCommitDialog({ source: "editor", appId });
            return;
          }
          if (isCommitting || isStartingAiFix) return;
          dismissDialog();
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden p-0"
          data-testid="editor-commit-dialog"
        >
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>{t("preview.commitChanges")}</DialogTitle>
            <DialogDescription>
              {t("preview.commitDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <label
                htmlFor="editor-commit-message"
                className="text-sm font-medium mb-2 block"
              >
                {t("preview.commitMessage")}
              </label>
              <Input
                id="editor-commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={t("preview.commitMessagePlaceholder")}
                data-testid="editor-commit-message-input"
              />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                {t("preview.filesToCommit", {
                  count: uncommittedFiles.length,
                })}
              </p>
              <CommitFileList
                files={uncommittedFiles}
                onSelectFile={(path) =>
                  openStagedDiff(path, { source: "editor", appId })
                }
                disabled={isCommitting || isStartingAiFix}
                testId="editor-commit-files-list"
              />
            </div>

            <CommitRecoveryAlerts
              preCommitError={preCommitError}
              prepareCommitMsgError={prepareCommitMsgError}
              commitMsgError={commitMsgError}
              commitError={commitError}
              isStartingAiFix={isStartingAiFix}
              isCheckingAiFixAvailability={isCheckingAiFixAvailability}
              aiFixUnavailableReason={aiFixUnavailableReason}
              onFixPreCommitWithAI={() => void handleFixPreCommitWithAI()}
            />
          </div>

          <DialogFooter className="px-6 pb-6 pt-2">
            <CommitDialogFooter
              isCommitting={isCommitting}
              isCancellingCommit={isCancellingCommit}
              phase={commitProgress?.phase ?? null}
              isBusy={isStartingAiFix}
              commitDisabled={
                !commitMessage.trim() || uncommittedFiles.length === 0
              }
              commitButtonTestId="editor-commit-confirm-button"
              onDismiss={dismissDialog}
              onCancelCommit={() => void cancelCommit()}
              onCommit={() => void handleCommit()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
