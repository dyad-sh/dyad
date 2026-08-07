import { useEffect, useRef, useState } from "react";
import { GitCommitVertical, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  clearStagedDiffAtom,
  commitMessageDraftAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  type CommitDialogSource,
} from "@/atoms/commitAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { cn } from "@/lib/utils";
import {
  getStatusIcon,
  generateDefaultCommitMessage,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";
import { CommitFileList } from "@/components/chat/CommitFileList";
import { useVersionPreview } from "@/hooks/useVersionPreview";

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
  const { commitChanges, isCommitting } = useCommitChanges();
  const [openCommitDialog, setOpenCommitDialog] = useAtom(openCommitDialogAtom);
  const openStagedDiffFile = useSetAtom(openStagedDiffAtom);
  const clearStagedDiff = useSetAtom(clearStagedDiffAtom);
  const setCommitMessageDraft = useSetAtom(commitMessageDraftAtom);
  const commitMessageDraft = useAtomValue(commitMessageDraftAtom);
  const { send: sendPreviewEvent } = useVersionPreview(appId);
  // Frozen at open so polling doesn't rewrite the suggestion under the user.
  // Only ever a suggestion: once the user types, the draft atom takes over.
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  // Read only at the moment the dialog opens, so the freeze above is against a
  // ref rather than a render-time dependency that would refresh with polling.
  const uncommittedFilesRef = useRef(uncommittedFiles);
  uncommittedFilesRef.current = uncommittedFiles;

  const isDialogOpen = openCommitDialog === "editor";

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

  const commitMessage =
    commitMessageDraft ??
    generatedMessage ??
    generateDefaultCommitMessage(uncommittedFiles);

  // Opening a staged file's diff must clear any selected version diff, since
  // CodeView suppresses staged-diff mode whenever a version diff is active.
  // `returnTo` is what brings the user back to the dialog they came from.
  const openStagedDiff = (
    filePath: string,
    returnTo: CommitDialogSource | null,
  ) => {
    sendPreviewEvent({ type: "CLOSE" });
    openStagedDiffFile({ path: filePath, returnTo });
  };

  // Dismissing without committing abandons the message: keeping it would
  // prefill a later, unrelated commit with text written for a change set that
  // has since moved on. The staged-diff round trip closes the dialog through
  // openStagedDiffAtom instead, so the draft survives that.
  const dismissDialog = () => {
    setOpenCommitDialog(null);
    setCommitMessageDraft(null);
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    try {
      await commitChanges({ appId, message: commitMessage.trim() });
    } catch {
      // useCommitChanges surfaces the error via a toast. Keep the dialog open
      // and preserve the message so the user can retry without retyping it.
      return;
    }
    setOpenCommitDialog(null);
    setCommitMessageDraft(null);
    // Nothing is staged anymore, so leave the diff view if it was open. This
    // must not reopen the dialog, hence clear rather than exit.
    clearStagedDiff();
  };

  return (
    <div className="flex items-center" data-testid="commit-menu">
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none border-r-0"
        disabled={!hasUncommittedFiles}
        onClick={() => setOpenCommitDialog("editor")}
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
            setOpenCommitDialog("editor");
            return;
          }
          if (isCommitting) return;
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
                onChange={(e) => setCommitMessageDraft(e.target.value)}
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
                onSelectFile={(path) => openStagedDiff(path, "editor")}
                disabled={isCommitting}
                testId="editor-commit-files-list"
              />
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-2">
            <Button
              variant="outline"
              onClick={dismissDialog}
              disabled={isCommitting}
            >
              {t("preview.cancel")}
            </Button>
            <Button
              onClick={handleCommit}
              disabled={
                !commitMessage.trim() ||
                isCommitting ||
                uncommittedFiles.length === 0
              }
              data-testid="editor-commit-confirm-button"
            >
              {isCommitting ? t("preview.committing") : t("preview.commit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
