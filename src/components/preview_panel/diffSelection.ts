import type { VersionChangedFile } from "@/ipc/types";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";

export function getDisplayedVersionDiffPath(
  changes: VersionChangedFile[] | null,
  selectedPath: string | null,
): string | null {
  if (!changes?.length) return null;

  return (
    changes.find((file) => file.path === selectedPath)?.path ?? changes[0].path
  );
}

export function getDisplayedStagedDiffPath(
  files: UncommittedFile[],
  selectedPath: string | null,
): string | null {
  return (
    files.find((file) => file.path === selectedPath)?.path ??
    files[0]?.path ??
    null
  );
}
