// =============================================================================
// Shared utilities for Local Vault UI
// =============================================================================

/**
 * Format byte count into human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Navigation tabs for the vault sub-pages */
export const VAULT_TABS = [
  { label: "Overview", path: "/local-vault" },
  { label: "Connectors", path: "/local-vault/connectors" },
  { label: "Transform", path: "/local-vault/data-studio" },
  { label: "Package & Publish", path: "/local-vault/packaging" },
] as const;
