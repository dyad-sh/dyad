import fs from "node:fs";
import path from "node:path";

import { readSettings } from "@/main/settings";
import { getGalleryMimeType, getMediaKind } from "./mime_utils";

/**
 * Folder inside the local vault that holds every image, video and attachment.
 * Both the app-generated `Generated/` subfolders and anything the user drops in
 * themselves live under here.
 */
export const VAULT_MEDIA_DIR_NAME = "Media";

/** Protocol host used to serve vault-relative media files to the renderer. */
export const VAULT_MEDIA_URL_HOST = "vault";

/** Directories that never contain user media and are expensive to walk. */
const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".meta-human",
  ".obsidian",
  ".trash",
  "node_modules",
]);

/** Guards against a pathological vault (or a symlink loop) hanging the walk. */
const MAX_DEPTH = 6;
const MAX_FILES = 5000;

/**
 * Vaults on external or network volumes collect macOS metadata sidecars
 * (`._image.png`, `.DS_Store`). They carry a media extension but no image data,
 * so they must never reach the gallery as broken thumbnails.
 */
function isHiddenOrSidecar(name: string): boolean {
  return name.startsWith(".");
}

export type LocalMediaKind = "image" | "video";

export type VaultMediaFile = {
  /** Vault-relative POSIX path, e.g. `Media/Images/Generated/cat.png`. */
  relativePath: string;
  absolutePath: string;
  fileName: string;
  kind: LocalMediaKind;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: number;
};

/**
 * Root of the configured local vault, or null when the user has not set one up.
 * Reads settings on every call so a vault chosen mid-session is picked up.
 */
export function getLocalVaultRoot(): string | null {
  const configured = readSettings().storage?.localVaultPath?.trim();
  if (!configured) return null;
  const root = path.resolve(configured);
  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  return root;
}

/**
 * Builds the URL the renderer uses to display a vault media file. The relative
 * path is encoded whole so slashes survive `new URL()` parsing intact.
 */
export function buildVaultMediaUrl(relativePath: string): string {
  return `dyad-media://${VAULT_MEDIA_URL_HOST}/${encodeURIComponent(relativePath)}`;
}

/**
 * Resolves a vault-relative media path to an absolute one, or null when it
 * escapes the vault's Media directory. This is the security boundary for the
 * `dyad-media://vault/...` protocol route.
 */
export function resolveVaultMediaPath(relativePath: string): string | null {
  const root = getLocalVaultRoot();
  if (!root) return null;

  const mediaRoot = path.resolve(path.join(root, VAULT_MEDIA_DIR_NAME));
  const resolved = path.resolve(path.join(root, relativePath));
  const relative = path.relative(mediaRoot, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return resolved;
}

async function walkMediaDir(
  root: string,
  dir: string,
  depth: number,
  out: VaultMediaFile[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      await walkMediaDir(root, fullPath, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || isHiddenOrSidecar(entry.name)) continue;

    const kind = getMediaKind(path.extname(entry.name));
    if (!kind) continue;

    try {
      const stat = await fs.promises.stat(fullPath);
      out.push({
        relativePath: path.relative(root, fullPath).split(path.sep).join("/"),
        absolutePath: fullPath,
        fileName: entry.name,
        kind,
        mimeType: getGalleryMimeType(path.extname(entry.name)),
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Deleted between readdir and stat — skip it.
    }
  }
}

/**
 * Every image and video stored in the local vault, including files the user
 * added by hand outside the app.
 */
export async function listVaultMedia(): Promise<VaultMediaFile[]> {
  const root = getLocalVaultRoot();
  if (!root) return [];

  const mediaRoot = path.join(root, VAULT_MEDIA_DIR_NAME);
  const files: VaultMediaFile[] = [];
  await walkMediaDir(root, mediaRoot, 0, files);
  return files;
}
