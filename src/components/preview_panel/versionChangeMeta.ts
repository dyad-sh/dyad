import type { VersionChangedFile } from "@/ipc/types";

// Display metadata (badge label + color) for each changed-file status. Kept in
// its own module — separate from VersionDiffView — so lightweight consumers
// (e.g. the chat's modified-files card) can import it without transitively
// pulling in the Monaco-backed diff editor.
export const STATUS_META: Record<
  VersionChangedFile["type"],
  { label: string; className: string }
> = {
  added: { label: "A", className: "text-green-600 dark:text-green-400" },
  modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
};
