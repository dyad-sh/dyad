import nodePath from "node:path";

/**
 * Keeping vault browsing inside the vault.
 *
 * The renderer asks for a folder by relative path, which means the renderer
 * decides what gets read. `../../..` is a valid relative path, so without this
 * the file manager would be a way to read any file on the machine through an
 * IPC channel that looks like it only lists a folder.
 *
 * Every path from the renderer goes through here, and anything that resolves
 * outside the vault root is refused rather than clamped: silently returning the
 * root for an escaping path would hide the attempt.
 */

export class VaultPathError extends Error {}

/**
 * The absolute path for a vault-relative request, or a thrown error.
 *
 * Empty string means the vault root. Absolute inputs are refused outright: a
 * relative path is what the contract asks for, and accepting an absolute one
 * would make the confinement depend on where it happened to point.
 */
export function resolveInsideVault(
  vaultRoot: string,
  relativePath: string,
): string {
  if (!vaultRoot) {
    throw new VaultPathError("No local vault is connected.");
  }
  if (nodePath.isAbsolute(relativePath)) {
    throw new VaultPathError("Path must be relative to the vault.");
  }
  if (relativePath.includes("\0")) {
    throw new VaultPathError("Path is not valid.");
  }

  const root = nodePath.resolve(vaultRoot);
  const target = nodePath.resolve(root, relativePath);

  // startsWith on the raw root would accept a sibling folder whose name begins
  // with the root's name, so compare against the root plus a separator, and
  // allow the root itself.
  if (target !== root && !target.startsWith(root + nodePath.sep)) {
    throw new VaultPathError("Path is outside the vault.");
  }
  return target;
}

/** The vault-relative form of an absolute path, using forward slashes. */
export function vaultRelativePath(vaultRoot: string, target: string): string {
  const relative = nodePath.relative(nodePath.resolve(vaultRoot), target);
  return relative.split(nodePath.sep).join("/");
}

/** The parent folder of a vault-relative path, or null at the root. */
export function vaultParentPath(relativePath: string): string | null {
  if (!relativePath) return null;
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/** Each folder on the way to a path, for a breadcrumb. */
export function vaultBreadcrumbs(
  relativePath: string,
): { name: string; path: string }[] {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
  }));
}
