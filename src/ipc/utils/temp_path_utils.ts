import path from "node:path";
import os from "node:os";

/**
 * Shared temp directory path for file attachments uploaded via chat.
 * Used by both the response processor and the local-agent copy_file tool.
 */
export const DYAD_ATTACHMENTS_DIR = path.join(os.tmpdir(), "dyad-attachments");

/**
 * Check if an absolute path falls within the dyad-attachments temp directory.
 * Used to validate that file copy operations only read from the allowed temp dir.
 */
export function isWithinTempAttachmentsDir(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const resolvedTempDir = path.resolve(DYAD_ATTACHMENTS_DIR);
  return (
    resolved.startsWith(resolvedTempDir + path.sep) ||
    resolved === resolvedTempDir
  );
}
