import { useState } from "react";
import {
  FileWarning,
  Plus,
  Pencil,
  Trash2,
  ArrowRightLeft,
} from "lucide-react";
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
  useUncommittedFiles,
  type UncommittedFile,
} from "@/hooks/useUncommittedFiles";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { cn } from "@/lib/utils";

interface UncommittedFilesBannerProps {
  appId: number | null;
}

function getStatusIcon(status: UncommittedFile["status"]) {
  switch (status) {
    case "added":
      return <Plus className="h-4 w-4 text-green-500" />;
    case "modified":
      return <Pencil className="h-4 w-4 text-yellow-500" />;
    case "deleted":
      return <Trash2 className="h-4 w-4 text-red-500" />;
    case "renamed":
      return <ArrowRightLeft className="h-4 w-4 text-blue-500" />;
    default:
      return null;
  }
}

function getStatusLabel(status: UncommittedFile["status"]) {
  switch (status) {
    case "added":
      return "Added";
    case "modified":
      return "Modified";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    default:
      return status;
  }
}

function generateDefaultCommitMessage(files: UncommittedFile[]): string {
  if (files.length === 0) return "";

  const added = files.filter((f) => f.status === "added").length;
  const modified = files.filter((f) => f.status === "modified").length;
  const deleted = files.filter((f) => f.status === "deleted").length;
  const renamed = files.filter((f) => f.status === "renamed").length;

  const parts: string[] = [];
  if (added > 0) parts.push(`add ${added} file${added > 1 ? "s" : ""}`);
  if (modified > 0)
    parts.push(`update ${modified} file${modified > 1 ? "s" : ""}`);
  if (deleted > 0)
    parts.push(`remove ${deleted} file${deleted > 1 ? "s" : ""}`);
  if (renamed > 0)
    parts.push(`rename ${renamed} file${renamed > 1 ? "s" : ""}`);

  if (parts.length === 0) return "Update files";

  // Capitalize first letter
  const message = parts.join(", ");
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export function UncommittedFilesBanner({ appId }: UncommittedFilesBannerProps) {
  const { uncommittedFiles, hasUncommittedFiles, isLoading } =
    useUncommittedFiles(appId);
  const { commitChanges, isCommitting } = useCommitChanges();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

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
    setIsDialogOpen(false);
    setCommitMessage("");
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
          // Prevent closing while committing
          if (!open && isCommitting) return;
          setIsDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="commit-dialog">
          <DialogHeader>
            <DialogTitle>Review & Commit Changes</DialogTitle>
            <DialogDescription>
              Review your changes and enter a commit message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Enter commit message..."
                data-testid="commit-message-input"
              />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                Changed files ({uncommittedFiles.length})
              </p>
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
                    <span
                      className={cn(
                        "flex-1 truncate font-mono text-xs",
                        file.status === "deleted" && "line-through opacity-60",
                      )}
                    >
                      {file.path}
                    </span>
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
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCommitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting}
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
