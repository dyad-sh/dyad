/**
 * Vault Path Sanitizer
 * Utilities for sanitizing project names and generating safe storage paths
 */

/**
 * Sanitize a project name for use in file paths
 * - Converts to lowercase
 * - Replaces unsafe characters with hyphens
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 * - Limits length to 50 characters
 */
export function sanitizeProjectName(name: string): string {
  if (!name || typeof name !== "string") {
    return "unnamed-project";
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-") // Replace unsafe chars with hyphens
      .replace(/-+/g, "-") // Collapse multiple hyphens
      .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
      .slice(0, 50) || // Limit length
    "unnamed-project"
  ); // Fallback if empty after sanitization
}

/**
 * Generate a storage path for a vault backup
 * Format: {userId}/{timestamp}-{safeProjectName}.zip
 */
export function generateStoragePath(
  userId: string,
  projectName: string,
  timestamp?: number,
): string {
  const ts = timestamp ?? Date.now();
  const safeName = sanitizeProjectName(projectName);
  return `${userId}/${ts}-${safeName}.zip`;
}

/**
 * Extract project name from a storage path
 * Returns the sanitized name portion without timestamp and extension
 */
export function extractProjectNameFromPath(storagePath: string): string | null {
  // Format: {userId}/{timestamp}-{projectName}.zip
  const match = storagePath.match(/\/\d+-(.+)\.zip$/);
  return match ? match[1] : null;
}

/**
 * Validate a backup ID (UUID format)
 */
export function isValidBackupId(backupId: string): boolean {
  if (!backupId || typeof backupId !== "string") {
    return false;
  }
  // UUID v4 format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(backupId);
}

/**
 * Validate a storage path format
 */
export function isValidStoragePath(path: string): boolean {
  if (!path || typeof path !== "string") {
    return false;
  }
  // Format: {uuid}/{timestamp}-{name}.zip
  const pathRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/\d+-[a-z0-9_-]+\.zip$/i;
  return pathRegex.test(path);
}
