import { formatDistanceToNow } from "date-fns";
import type { Version } from "@/ipc/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export function ExtraCommitsRevertDialog({
  open,
  onOpenChange,
  kind,
  extraCommits,
  onConfirm,
  onRetryFromCurrentCode,
  uncommittedFileCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "undo" | "retry";
  extraCommits: Version[];
  onConfirm: () => void;
  onRetryFromCurrentCode?: () => void;
  uncommittedFileCount?: number;
}) {
  const action = kind === "undo" ? "Undo" : "Retry";
  const commitLabel = extraCommits.length === 1 ? "commit was" : "commits were";
  const commitNoun = extraCommits.length === 1 ? "commit" : "commits";
  const isRetry = kind === "retry";
  const hasUncommittedChanges = uncommittedFileCount > 0;
  const uncommittedLabel =
    uncommittedFileCount === 1 ? "file change" : "file changes";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="extra-commits-revert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRetry
              ? "How would you like to retry?"
              : "Undo will revert additional changes"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRetry ? (
              hasUncommittedChanges ? (
                <>
                  Your app has {uncommittedFileCount} uncommitted{" "}
                  {uncommittedLabel}
                  {extraCommits.length > 0
                    ? ` and ${extraCommits.length} newer ${commitNoun}`
                    : ""}
                  . Please commit your changes before using Restore and retry.
                  You can still retry from the current code now.
                </>
              ) : (
                <>
                  {extraCommits.length} newer {commitLabel} made after this
                  response. Retry from the current code to keep them, or restore
                  and retry to revert them:
                </>
              )
            ) : (
              <>
                Besides this message&apos;s changes, {extraCommits.length} more{" "}
                {commitLabel} made afterwards. Undoing will also revert them:
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="scrollbar-on-hover max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
          {hasUncommittedChanges && (
            <div className="min-w-0 text-sm">
              <p className="font-medium text-foreground">
                {uncommittedFileCount} uncommitted {uncommittedLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                Not committed to version history
              </p>
            </div>
          )}
          {extraCommits.map((commit) => (
            <div key={commit.oid} className="min-w-0 text-sm">
              <p className="truncate font-medium text-foreground">
                {commit.message.split("\n", 1)[0] || "Untitled commit"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(commit.timestamp * 1000), {
                  addSuffix: true,
                })}
              </p>
            </div>
          ))}
        </div>
        <AlertDialogFooter className="flex-col sm:flex-col sm:justify-normal">
          {isRetry && onRetryFromCurrentCode && (
            <AlertDialogAction
              data-testid="retry-from-current-code-button"
              className="w-full"
              onClick={onRetryFromCurrentCode}
            >
              Retry from current code
            </AlertDialogAction>
          )}
          {!hasUncommittedChanges && (
            <AlertDialogAction
              data-testid="confirm-revert-anyway-button"
              className={`${buttonVariants({ variant: "destructive" })} w-full`}
              onClick={onConfirm}
            >
              {isRetry ? "Restore and retry" : `${action} anyway`}
            </AlertDialogAction>
          )}
          <AlertDialogCancel
            data-testid="cancel-revert-button"
            className="w-full"
          >
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
