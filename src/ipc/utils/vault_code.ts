import fs from "node:fs";
import path from "node:path";

/**
 * Project code in the vault.
 *
 * `Code/<app-path>` inside the vault mirrors the app's working directory in
 * `dyad-apps` — including `.git`, so picking a project back up keeps its whole
 * history. Reinstall the app or move machines, open the project from the Apps
 * screen, and the code is restored into place before the coder touches it.
 *
 * The vault copy is a mirror, not the live working directory: dev servers,
 * installs and git operate on the `dyad-apps` copy, which stays on a proper
 * filesystem.
 */

export const VAULT_CODE_FOLDER = "Code";

/** Build output and dependency caches: heavy, and always reproducible. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".vite",
  "coverage",
]);

const EXCLUDED_FILES = new Set([".DS_Store"]);

export function vaultCodePath(vaultRoot: string, appPath?: string): string {
  return appPath
    ? path.join(vaultRoot, VAULT_CODE_FOLDER, appPath)
    : path.join(vaultRoot, VAULT_CODE_FOLDER);
}

async function copyTree(source: string, destination: string): Promise<number> {
  let copied = 0;
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied += await copyTree(from, to);
    } else if (entry.isFile()) {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Mirrors one app's source into the vault. Returns how many files were
 * written; 0 means the app directory did not exist.
 */
export async function syncAppCodeToVault(input: {
  appDir: string;
  vaultRoot: string;
  appPath: string;
}): Promise<number> {
  const { appDir, vaultRoot, appPath } = input;
  if (!fs.existsSync(appDir)) return 0;
  return copyTree(appDir, vaultCodePath(vaultRoot, appPath));
}

/**
 * Puts a vault copy back into the working directory, so opening the project
 * simply works on a machine that has never seen it.
 *
 * Never overwrites: a working directory that already has files is the source
 * of truth, and the mirror must not clobber newer local work.
 */
export async function restoreAppCodeFromVault(input: {
  vaultRoot: string;
  appPath: string;
  appDir: string;
}): Promise<{ restored: boolean; files: number }> {
  const { vaultRoot, appPath, appDir } = input;

  const hasLocal =
    fs.existsSync(appDir) && (await fs.promises.readdir(appDir)).length > 0;
  if (hasLocal) return { restored: false, files: 0 };

  const source = vaultCodePath(vaultRoot, appPath);
  if (!fs.existsSync(source)) return { restored: false, files: 0 };

  const files = await copyTree(source, appDir);
  return { restored: files > 0, files };
}

/** The starter note explaining the folder, written once. */
export const CODE_FOLDER_README = `---
type: code-index
tags:
  - meta-human
  - code
---

# Code

Every project built with the coder is mirrored here automatically — source and
git history, without \`node_modules\` or build output.

Open a project from the **Apps** screen and, if its working copy is missing on
this machine, it is restored from here first so you continue exactly where you
left off. The working copy in \`dyad-apps\` remains the live one; this folder is
your durable, portable backup.
`;
