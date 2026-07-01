import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";
import { getStatusIcon, getStatusLabel } from "./uncommitted-files-utils";
import { cn } from "@/lib/utils";

interface UncommittedChangesReviewProps {
  files: UncommittedFile[];
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onCommit: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  isCommitting: boolean;
  isDiscarding: boolean;
  showDiscardConfirm: boolean;
  onShowDiscardConfirm: (value: boolean) => void;
}

/**
 * Shared body (commit-message input + changed-files list + discard-confirm panel
 * + footer actions) for reviewing uncommitted changes. Rendered inside a Dialog by
 * both {@link UncommittedFilesBanner} and {@link UncommittedChangesGateDialog}.
 */
export function UncommittedChangesReview({
  files,
  commitMessage,
  onCommitMessageChange,
  onCommit,
  onDiscard,
  onCancel,
  isCommitting,
  isDiscarding,
  showDiscardConfirm,
  onShowDiscardConfirm,
}: UncommittedChangesReviewProps) {
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

  return (
    <>
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
            onChange={(e) => onCommitMessageChange(e.target.value)}
            placeholder="Enter commit message..."
            data-testid="commit-message-input"
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-2">
            Changed files ({files.length})
          </p>
          <TooltipProvider delay={300}>
            <div
              className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1"
              data-testid="changed-files-list"
            >
              {files.map((file) => (
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
                  <span
                    className={cn(
                      "text-xs px-1.5 py-0.5 rounded",
                      file.status === "added" &&
                        "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                      file.status === "modified" &&
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
                      file.status === "deleted" &&
                        "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                      file.status === "renamed" &&
                        "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
                    )}
                  >
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
              Discard changes to {files.length}{" "}
              {files.length === 1 ? "file" : "files"}?{" "}
              <span id="discard-confirm-desc">This cannot be undone.</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={onDiscard}
                disabled={isCommitting || isDiscarding}
                data-testid="confirm-discard-button"
              >
                {isDiscarding ? "Discarding..." : "Yes, discard all"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onShowDiscardConfirm(false)}
                disabled={isCommitting || isDiscarding}
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
          onClick={() => onShowDiscardConfirm(true)}
          disabled={isCommitting || isDiscarding || showDiscardConfirm}
          data-testid="discard-button"
        >
          Discard all
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isCommitting || isDiscarding}
        >
          Cancel
        </Button>
        <Button
          onClick={onCommit}
          disabled={!commitMessage.trim() || isCommitting || isDiscarding}
          data-testid="commit-button"
        >
          {isCommitting ? "Committing..." : "Commit"}
        </Button>
      </DialogFooter>
    </>
  );
}
