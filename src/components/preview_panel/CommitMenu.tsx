import { useState } from "react";
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
import { stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { cn } from "@/lib/utils";
import {
  getStatusIcon,
  getStatusLabel,
  getStatusBadgeClassName,
  generateDefaultCommitMessage,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";
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
  const setStagedDiffFile = useSetAtom(stagedDiffFileAtom);
  const { send: sendPreviewEvent } = useVersionPreview(appId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  // Opening a staged file's diff must clear any selected version diff, since
  // CodeView suppresses staged-diff mode whenever a version diff is active.
  const openStagedDiff = (filePath: string) => {
    sendPreviewEvent({ type: "CLOSE" });
    setStagedDiffFile(filePath);
  };

  const handleOpenDialog = () => {
    // Prefill only when opening so polling doesn't overwrite the user's edits.
    setCommitMessage(generateDefaultCommitMessage(uncommittedFiles));
    setIsDialogOpen(true);
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
    setIsDialogOpen(false);
    setCommitMessage("");
    // Nothing is staged anymore, so leave the diff view if it was open.
    setStagedDiffFile(null);
  };

  return (
    <div className="flex items-center" data-testid="commit-menu">
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none border-r-0"
        disabled={!hasUncommittedFiles}
        onClick={handleOpenDialog}
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
                onClick={() => openStagedDiff(file.path)}
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
          if (!open && isCommitting) return;
          setIsDialogOpen(open);
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
              <div
                className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1"
                data-testid="editor-commit-files-list"
              >
                {uncommittedFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted"
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
                    <span className={getStatusBadgeClassName(file.status)}>
                      {getStatusLabel(file.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
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
