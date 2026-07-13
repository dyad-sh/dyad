import { Plus, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";

export function getStatusIcon(status: UncommittedFile["status"]) {
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

export function getStatusLabel(status: UncommittedFile["status"]) {
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

export function getStatusBadgeClassName(status: UncommittedFile["status"]) {
  return cn(
    "text-xs px-1.5 py-0.5 rounded",
    status === "added" &&
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    status === "modified" &&
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    status === "deleted" &&
      "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    status === "renamed" &&
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  );
}

/**
 * Renders the per-file added/deleted line counts as `+N` (green) / `−N` (red).
 * Counts of 0 are omitted; nothing renders when both are 0.
 */
export function LineStats({ file }: { file: UncommittedFile }) {
  if (!file.additions && !file.deletions) return null;
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
      {file.additions > 0 && (
        <span className="text-green-600 dark:text-green-400">
          +{file.additions}
        </span>
      )}
      {file.deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">
          −{file.deletions}
        </span>
      )}
    </span>
  );
}

export function generateDefaultCommitMessage(files: UncommittedFile[]): string {
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
