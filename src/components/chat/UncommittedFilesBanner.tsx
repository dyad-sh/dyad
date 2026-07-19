import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FileWarning, TriangleAlert } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { useDiscardChanges } from "@/hooks/useDiscardChanges";
import { cn } from "@/lib/utils";
import {
  getStatusIcon,
  getStatusLabel,
  getStatusBadgeClassName,
  generateDefaultCommitMessage,
} from "@/components/chat/uncommittedFileStatus";

interface UncommittedFilesBannerProps {
  appId: number | null;
}

export function UncommittedFilesBanner({ appId }: UncommittedFilesBannerProps) {
  const { t } = useTranslation("chat");
  const { uncommittedFiles, hasUncommittedFiles, isLoading } =
    useUncommittedFiles(appId);
  const { commitChanges, isCommitting } = useCommitChanges();
  const { discardChanges, isDiscarding } = useDiscardChanges();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const confirmPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showDiscardConfirm) {
      confirmPanelRef.current
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="confirm-discard-button"]',
        )
        ?.focus();
    }
  }, [showDiscardConfirm]);

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
            {t("uncommittedChanges", { count: uncommittedFiles.length })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDialog}
          data-testid="review-commit-button"
        >
          {t("reviewCommitChanges")}
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
            <DialogTitle>{t("reviewCommitChanges")}</DialogTitle>
            <DialogDescription>
              {t("reviewChangesDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <label
                htmlFor="commit-message"
                className="text-sm font-medium mb-2 block"
              >
                {t("commitMessage")}
              </label>
              <Input
                id="commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={t("enterCommitMessage")}
                data-testid="commit-message-input"
              />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                {t("changedFiles", { count: uncommittedFiles.length })}
              </p>
              <TooltipProvider delay={300}>
                <div
                  className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1"
                  data-testid="changed-files-list"
                >
                  {uncommittedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted"
                    >
                      {getStatusIcon(file.status)}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className={cn(
                                "flex-1 truncate font-mono text-xs text-left cursor-default",
                                file.status === "deleted" &&
                                  "line-through opacity-60",
                              )}
                            />
                          }
                        >
                          {file.path}
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start">
                          <p className="max-w-[400px] break-all">{file.path}</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className={getStatusBadgeClassName(file.status)}>
                        {getStatusLabel(file.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </TooltipProvider>
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
                  {t("discardChangesTo", {
                    count: uncommittedFiles.length,
                    label: t("fileCount", { count: uncommittedFiles.length }),
                  })}{" "}
                  <span id="discard-confirm-desc">
                    {t("thisCannotBeUndone")}
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDiscard}
                    disabled={isDiscarding}
                    data-testid="confirm-discard-button"
                  >
                    {isDiscarding ? t("discarding") : t("yesDiscardAll")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDiscardConfirm(false)}
                    disabled={isDiscarding}
                  >
                    {t("keepChanges")}
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
              {t("discardAll")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCommitting || isDiscarding}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting || isDiscarding}
              data-testid="commit-button"
            >
              {isCommitting ? t("committing") : t("commit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
