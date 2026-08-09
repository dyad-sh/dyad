import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { uploadToBlob, listBlobs } from "./vercel_blob";
import { VAULT_FOLDERS, vaultStarterFiles } from "./vault_structure";

/**
 * The cloud copy of the vault.
 *
 * A vault should mean the same thing wherever it lives: the same folders, the
 * same starter notes, the same paths. Cloud storage used to receive only the
 * files a sync happened to generate, which made "vault" mean one thing on disk
 * and something thinner in the cloud. This scaffolds the real structure and,
 * when a local vault exists, copies it across exactly.
 *
 * Everything lives under a single prefix so the store can hold other things
 * without the two becoming entangled.
 */

const logger = log.scope("blob_vault");

/** Everything vault-related lives here, and nothing else does. */
export const BLOB_VAULT_PREFIX = "vault";

/**
 * Blob storage has no directories, only keys.
 *
 * A folder is represented by a keep-file so an empty folder still exists after
 * a round trip, which is what makes the cloud copy browsable rather than a
 * flat list that happens to contain slashes.
 */
const KEEP_FILE = ".keep";

export function blobVaultKey(relativePath: string): string {
  // Always forward slashes: a Windows path separator in a blob key would
  // create a literal backslash in the name rather than a folder.
  const normalised = relativePath.split(path.sep).join("/").replace(/^\/+/, "");
  return `${BLOB_VAULT_PREFIX}/${normalised}`;
}

/** Files that should never leave the machine, whatever the sync is doing. */
export function isExcludedFromCloud(relativePath: string): boolean {
  const normalised = relativePath.split(path.sep).join("/");
  const name = normalised.split("/").pop() ?? "";

  return (
    // The vault's mirrored API keys. Uploading them would take a file that is
    // deliberately local and put it somewhere it can be fetched with a token.
    name === ".env" ||
    // Obsidian's per-machine workspace state: noise, and it fights itself
    // across two machines syncing the same store.
    normalised.startsWith(".obsidian/workspace") ||
    name === ".DS_Store" ||
    // Git internals of mirrored projects. The working tree is what is worth
    // preserving; the object store is large and rebuildable.
    normalised.includes("/.git/") ||
    normalised.startsWith(".git/")
  );
}

/**
 * Creates the vault structure in blob storage.
 *
 * Idempotent, and it never overwrites: a starter note the user has since
 * edited stays edited. Called when a store is connected so the structure
 * exists before anything is synced into it.
 */
export async function scaffoldBlobVault(): Promise<{
  folders: number;
  files: number;
}> {
  const existing = new Set(
    (await listBlobs(`${BLOB_VAULT_PREFIX}/`)).map((item) => item.pathname),
  );

  let folders = 0;
  for (const folder of VAULT_FOLDERS) {
    const key = blobVaultKey(`${folder}/${KEEP_FILE}`);
    if (existing.has(key)) continue;
    await uploadToBlob(key, Buffer.from(""), {
      contentType: "text/plain",
      allowOverwrite: false,
    });
    folders += 1;
  }

  let files = 0;
  for (const [relativePath, contents] of Object.entries(vaultStarterFiles())) {
    if (isExcludedFromCloud(relativePath)) continue;
    const key = blobVaultKey(relativePath);
    // Never overwrite: these are starting points, and the user's edits to them
    // are theirs.
    if (existing.has(key)) continue;
    await uploadToBlob(key, Buffer.from(contents, "utf8"), {
      contentType: relativePath.endsWith(".json")
        ? "application/json"
        : "text/markdown",
      allowOverwrite: false,
    });
    files += 1;
  }

  logger.log(`Scaffolded cloud vault: ${folders} folders, ${files} files`);
  return { folders, files };
}

/** Every file beneath a directory, as paths relative to it. */
async function walk(root: string, current = root): Promise<string[]> {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(root, absolute)));
    } else if (entry.isFile()) {
      found.push(path.relative(root, absolute));
    }
  }
  return found;
}

export type MirrorResult = {
  uploaded: number;
  skipped: number;
  excluded: number;
  failed: number;
};

/**
 * Copies a local vault into blob storage exactly.
 *
 * Paths are preserved, so a file at `Notes/Daily/2026-08-10.md` on disk is at
 * `vault/Notes/Daily/2026-08-10.md` in the store and comes back to the same
 * place. Unchanged files are skipped by size, which is a cheap comparison that
 * catches edits without downloading anything to compare.
 *
 * One unreadable file does not fail the mirror. A vault is often thousands of
 * files, and abandoning the whole copy because one is locked would mean the
 * copy never finishes on a machine where anything has a lock.
 */
export async function mirrorLocalVaultToBlob(
  vaultPath: string,
  options: { force?: boolean } = {},
): Promise<MirrorResult> {
  // Checked here rather than imported from the local writer, which would
  // make the backup depend on the thing it backs up.
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    throw new Error("The local vault folder is not available.");
  }

  const existing = new Map(
    (await listBlobs(`${BLOB_VAULT_PREFIX}/`)).map((item) => [
      item.pathname,
      item.size,
    ]),
  );

  const relativePaths = await walk(vaultPath);
  const result: MirrorResult = {
    uploaded: 0,
    skipped: 0,
    excluded: 0,
    failed: 0,
  };

  for (const relativePath of relativePaths) {
    if (isExcludedFromCloud(relativePath)) {
      result.excluded += 1;
      continue;
    }

    const absolute = path.join(vaultPath, relativePath);
    const key = blobVaultKey(relativePath);

    try {
      const stats = await fs.promises.stat(absolute);
      const known = existing.get(key);
      if (!options.force && known !== undefined && known === stats.size) {
        result.skipped += 1;
        continue;
      }

      const data = await fs.promises.readFile(absolute);
      await uploadToBlob(key, data, { allowOverwrite: true });
      result.uploaded += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn(
        `Could not mirror ${relativePath}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  logger.log(
    `Mirrored local vault to cloud: ${result.uploaded} uploaded, ${result.skipped} unchanged, ${result.excluded} excluded, ${result.failed} failed`,
  );
  return result;
}
