import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Release CI uploads source maps to PostHog error tracking so minified stack
 * traces from packaged builds resolve to original source. Local and PR builds
 * never set this flag and are unchanged.
 *
 * The build job only prepares the maps: it tags each bundle with a chunk ID,
 * then moves the maps out of the app into POSTHOG_SOURCEMAPS_DIR. A separate
 * release CI job, without the signing credentials, uploads that directory with
 * posthog-cli. No PostHog code runs in the job that signs the app, and nothing
 * outside this repo edits the shipped bundles.
 */
export const POSTHOG_UPLOAD_SOURCEMAPS_ENV = "POSTHOG_UPLOAD_SOURCEMAPS";
export const POSTHOG_SOURCEMAPS_DIR_ENV = "POSTHOG_SOURCEMAPS_DIR";

export function isPostHogSourcemapUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[POSTHOG_UPLOAD_SOURCEMAPS_ENV] === "true";
}

/**
 * Makes a Vite build emit hidden source maps (no sourceMappingURL comment)
 * when uploads are enabled, for `stagePostHogSourcemaps` to consume.
 */
export function posthogHiddenSourcemapsPlugin(
  env: NodeJS.ProcessEnv = process.env,
): Plugin[] {
  if (!isPostHogSourcemapUploadEnabled(env)) {
    return [];
  }
  return [
    {
      name: "dyad-posthog-hidden-sourcemaps",
      config: () => ({ build: { sourcemap: "hidden" } }),
    },
  ];
}

/**
 * Registers the bundle's chunk ID on `globalThis._posthogChunkIds`, keyed by a
 * stack trace captured inside the bundle; posthog-js reads this registry to
 * tell PostHog which uploaded map belongs to each stack frame. This matches
 * the snippet posthog-cli's `sourcemap inject` adds. It never throws, so it
 * cannot stop a bundle from loading.
 */
function chunkIdSnippet(chunkId: string): string {
  return `;!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]=${JSON.stringify(chunkId)})}catch(e){}}();`;
}

/** A trailing comment pointing at the map, which is not shipped. */
const SOURCE_MAPPING_URL_COMMENT = /\n\/\/[#@] sourceMappingURL=[^\n]*\s*$/;

export interface InjectedBundle {
  chunkId: string;
  code: string;
  map: string;
}

/**
 * Tags a bundle and its source map with a chunk ID. The ID is a hash of both
 * files, so rebuilding the same release reproduces it and PostHog skips the
 * duplicate upload.
 *
 * The snippet is appended rather than prepended: a bundle's first statement
 * can be a "use strict" directive, which stops applying if anything comes
 * before it, and code added at the end leaves every mapped position, and so
 * the map's mappings, unchanged. The snippet runs once the bundle has loaded,
 * before any error from it can be captured.
 */
export function injectChunkId(code: string, mapText: string): InjectedBundle {
  const map = JSON.parse(mapText) as Record<string, unknown>;
  if (code.includes("//# chunkId=") || map.chunk_id !== undefined) {
    throw new Error("Bundle already has a chunk ID");
  }
  const chunkId = contentChunkId(code, mapText);

  const injectedCode =
    code.replace(SOURCE_MAPPING_URL_COMMENT, "") +
    `\n${chunkIdSnippet(chunkId)}\n//# chunkId=${chunkId}\n`;
  const injectedMap = { ...map, chunk_id: chunkId };

  return { chunkId, code: injectedCode, map: JSON.stringify(injectedMap) };
}

/** Formatted as a UUID, like posthog-cli's chunk IDs. */
function contentChunkId(code: string, mapText: string): string {
  const hex = createHash("sha256")
    .update(code)
    .update("\0")
    .update(mapText)
    .digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface StagePostHogSourcemapsOptions {
  /** The packaged app directory, before it is archived into app.asar. */
  buildPath: string;
  /** Identifies this build's maps, e.g. `darwin-arm64`. */
  target: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs from Forge's afterCopy hook, after Vite has written source maps into
 * `<buildPath>/.vite` and before the asar is created. Tags each bundle that
 * has a map with a chunk ID, then moves the map, with a copy of its tagged
 * bundle (posthog-cli uploads them as a pair), to
 * `<POSTHOG_SOURCEMAPS_DIR>/<target>`. Fails if any map would still ship.
 */
export async function stagePostHogSourcemaps({
  buildPath,
  target,
  env = process.env,
}: StagePostHogSourcemapsOptions): Promise<void> {
  if (!isPostHogSourcemapUploadEnabled(env)) {
    return;
  }
  const stagingRoot = env[POSTHOG_SOURCEMAPS_DIR_ENV];
  if (!stagingRoot) {
    throw new Error(
      `${POSTHOG_UPLOAD_SOURCEMAPS_ENV}=true but ${POSTHOG_SOURCEMAPS_DIR_ENV} is not set; refusing to package a release without its source maps.`,
    );
  }

  const viteDir = path.join(buildPath, ".vite");
  const stagingDir = path.join(stagingRoot, target);
  // A retried build replaces the maps from the failed attempt.
  await rm(stagingDir, { recursive: true, force: true });

  let maps: string[];
  try {
    maps = await listMapFiles(viteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No Vite output found at ${viteDir}; cannot stage source maps for this release.`,
      );
    }
    throw error;
  }
  let staged = 0;
  for (const mapFile of maps) {
    const bundleFile = mapFile.slice(0, -".map".length);
    const bundlePath = path.join(viteDir, bundleFile);
    const mapPath = path.join(viteDir, mapFile);
    if (!bundleFile.endsWith(".js")) {
      // PostHog only uses JavaScript maps; others, such as CSS maps, must
      // still not ship.
      await rm(mapPath);
      continue;
    }
    let code: string;
    try {
      code = await readFile(bundlePath, "utf8");
    } catch {
      continue; // No bundle to tag; the leftover check below reports the map.
    }
    const injected = injectChunkId(code, await readFile(mapPath, "utf8"));

    await writeFile(bundlePath, injected.code);
    const stagedBundle = path.join(stagingDir, bundleFile);
    await mkdir(path.dirname(stagedBundle), { recursive: true });
    await copyFile(bundlePath, stagedBundle);
    await writeFile(`${stagedBundle}.map`, injected.map);
    await rm(mapPath);
    staged++;
  }

  if (staged === 0) {
    throw new Error(
      `No source maps found in ${viteDir}; the release would ship without symbolicated errors.`,
    );
  }
  const leftoverMaps = await listMapFiles(viteDir);
  if (leftoverMaps.length > 0) {
    throw new Error(
      `Source maps without a matching bundle in ${viteDir} would ship in the app: ${leftoverMaps.join(", ")}`,
    );
  }
}

async function listMapFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries.filter((entry) => entry.endsWith(".map")).sort();
}
