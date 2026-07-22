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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "undo" | "retry";
  extraCommits: Version[];
  onConfirm: () => void;
}) {
  const action = kind === "undo" ? "Undo" : "Retry";
  const commitLabel = extraCommits.length === 1 ? "commit was" : "commits were";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="extra-commits-revert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action} will revert additional changes
          </AlertDialogTitle>
          <AlertDialogDescription>
            Besides this message&apos;s changes, {extraCommits.length} more{" "}
            {commitLabel} made afterwards.{" "}
            {action === "Undo" ? "Undoing" : "Retrying"} will also revert them:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="scrollbar-on-hover max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
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
          <AlertDialogAction
            data-testid="confirm-revert-anyway-button"
            className={`${buttonVariants({ variant: "destructive" })} w-full`}
            onClick={onConfirm}
          >
            {action} anyway
          </AlertDialogAction>
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
