import { Plus, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
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
