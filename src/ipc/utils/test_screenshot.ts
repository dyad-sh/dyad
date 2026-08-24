import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import {
  E2E_TEST_ARTIFACT_DIR,
  runDirectoryAppId,
} from "@/ipc/services/e2e_test_workspace";

const logger = log.scope("test_screenshot");

/**
 * Refuse to read screenshots above this size. The base64 data URL inflates the
 * image by ~33% before going over IPC or into a model request, so an
 * unexpectedly huge Playwright artifact should degrade to "no screenshot"
 * rather than blow up the agent request. Real failure screenshots are well
 * under this.
 */
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/**
 * Resolve a Playwright artifact path through symlinks and confirm it lives
 * under the app's `test-results/` directory, or under this app's retained
 * per-run artifacts in user data. Returns the real path, or null when it
 * escapes both.
 */
async function resolveContainedArtifact(
  appPath: string,
  artifactPath: string,
  appId: number | undefined,
): Promise<string | null> {
  // Playwright reports absolute paths, but resolve relative ones against the
  // app dir just in case.
  const resolved = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(appPath, artifactPath);
  // No existsSync pre-check: realpath below already rejects a missing path
  // (throws → caught → null), and a separate check would open a TOCTOU window
  // where the path could be swapped for a symlink between check and resolve.
  // Resolve symlinks before the containment check: a symlink inside the app dir
  // could otherwise point outside it and pass a string-only check while the
  // read escapes. Resolve the app path too so ancestor symlinks (e.g.
  // /var -> /private/var on macOS) don't leave a `..` prefix.
  let realAppPath: string;
  let realArtifactRoot: string | undefined;
  let realPath: string;
  try {
    [realAppPath, realPath] = await Promise.all([
      fs.promises.realpath(appPath),
      fs.promises.realpath(resolved),
    ]);
    try {
      realArtifactRoot = await fs.promises.realpath(
        path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),
      );
    } catch {
      // No retained sandbox artifacts yet.
    }
  } catch (error) {
    logger.warn(`Failed to resolve test artifact path ${resolved}: ${error}`);
    return null;
  }
  const appRelative = path.relative(realAppPath, realPath);
  const insideApp =
    appRelative !== "" &&
    !appRelative.startsWith("..") &&
    !path.isAbsolute(appRelative);
  const artifactRelative = realArtifactRoot
    ? path.relative(realArtifactRoot, realPath)
    : "";
  const insideArtifacts =
    artifactRelative !== "" &&
    !artifactRelative.startsWith("..") &&
    !path.isAbsolute(artifactRelative);
  if (!insideApp && !insideArtifacts) {
    return null;
  }
  // Artifacts win when both match. `userData` can sit inside the project (a
  // portable or dev install), which makes every retained artifact *also* look
  // like an app path — and reading it as one skips the app-id check and then
  // compares the run directory name against "test-results", so a perfectly
  // legitimate thumbnail silently fails to load.
  const useArtifactRoot = insideArtifacts;
  // Only serve files under `test-results/`, not anything else in the app. Use
  // split (not a string prefix) so a sibling like `test-results-foo/` can't
  // slip through.
  const segments = (useArtifactRoot ? artifactRelative : appRelative).split(
    path.sep,
  );
  // Retained artifacts are namespaced by run directory (`<appId>-<id>/`), so
  // the `test-results` segment is one deeper — and the app id has to match, or
  // one app could read another's screenshots.
  const testResultsSegment = useArtifactRoot ? segments[1] : segments[0];
  if (
    useArtifactRoot &&
    (appId === undefined || runDirectoryAppId(segments[0]) !== appId)
  ) {
    return null;
  }
  if (testResultsSegment !== "test-results") {
    return null;
  }
  return realPath;
}

/**
 * Read a Playwright failure screenshot as a PNG data URL, enforcing the same
 * containment guards as the `tests:screenshot` IPC handler: PNG-only, resolved
 * through symlinks, and inside the app's `test-results/` directory. Returns
 * null if the path is missing, not a PNG, or escapes both the app and Dyad's
 * retained per-run artifact root.
 *
 * Shared by the IPC handler (renderer thumbnails) and the agent's run_tests
 * tool (attaching a failure screenshot to the model).
 */
export async function readTestScreenshotDataUrl(
  appPath: string,
  screenshotPath: string,
  appId?: number,
): Promise<string | null> {
  if (path.extname(screenshotPath).toLowerCase() !== ".png") {
    return null;
  }
  const realPath = await resolveContainedArtifact(
    appPath,
    screenshotPath,
    appId,
  );
  if (realPath === null) {
    return null;
  }
  // Re-check the extension on the REAL (symlink-resolved) path: a `foo.png`
  // symlink pointing at a `.env.local` would otherwise pass the initial gate.
  if (path.extname(realPath).toLowerCase() !== ".png") {
    return null;
  }
  let handle: fs.promises.FileHandle | undefined;
  try {
    // O_NOFOLLOW closes the TOCTOU gap between the realpath check above and
    // this open by refusing to follow a symlink swapped in afterwards. It is a
    // defense-in-depth layer only: the realpath + containment check is the
    // primary guard. On Windows O_NOFOLLOW is undefined, so this falls back to
    // 0 (no effect) and the open-level guard is a no-op there — acceptable
    // because creating a symlink on Windows requires elevated privileges.
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    handle = await fs.promises.open(realPath, fs.constants.O_RDONLY | noFollow);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return null;
    }
    const { size } = stats;
    if (size > MAX_SCREENSHOT_BYTES) {
      logger.warn(
        `Screenshot ${realPath} is ${size} bytes (limit ${MAX_SCREENSHOT_BYTES}); skipping`,
      );
      return null;
    }
    // Read at most the size we just validated, rather than readFile()'s
    // read-then-check: a file still growing after the stat would otherwise
    // allocate an unbounded buffer before the limit could reject it.
    const buf = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(
        buf,
        offset,
        size - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    // A screenshot that changed mid-read is a partially-written artifact; a
    // truncated PNG is worth less to the model than an honest "no screenshot".
    if (offset !== size || (await handle.stat()).size !== size) {
      logger.warn(`Screenshot ${realPath} changed while being read; skipping`);
      return null;
    }
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (error) {
    logger.warn(`Failed to read screenshot ${realPath}: ${error}`);
    return null;
  } finally {
    await handle?.close().catch((error) => {
      logger.warn(`Failed to close screenshot ${realPath}: ${error}`);
    });
  }
}

/**
 * Refuse to inline a page snapshot above this size. `error-context.md` is
 * Playwright's accessibility-tree dump of the failing page; a pathological one
 * would otherwise dominate the model request.
 */
const MAX_ERROR_CONTEXT_BYTES = 24 * 1024;

/**
 * Read the `error-context.md` page snapshot Playwright writes beside a failure
 * screenshot, under the same containment guards as the screenshot reader.
 *
 * Used when the artifact lives outside the app — a sandboxed run retains it in
 * user data, where the agent's `read_file` cannot reach — so the snapshot can
 * be inlined instead of pointed at with a path that would only fail.
 */
export async function readTestErrorContext(
  appPath: string,
  screenshotPath: string,
  appId?: number,
): Promise<string | null> {
  const contextPath = path.join(
    path.dirname(screenshotPath),
    "error-context.md",
  );
  const realPath = await resolveContainedArtifact(appPath, contextPath, appId);
  if (realPath === null) {
    return null;
  }
  // Re-check on the REAL path, for the same reason the screenshot reader does:
  // an `error-context.md` symlink could otherwise point at `.env.local`.
  if (path.extname(realPath).toLowerCase() !== ".md") {
    return null;
  }
  let handle: fs.promises.FileHandle | undefined;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    handle = await fs.promises.open(realPath, fs.constants.O_RDONLY | noFollow);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return null;
    }
    const size = Math.min(stats.size, MAX_ERROR_CONTEXT_BYTES);
    const buf = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(
        buf,
        offset,
        size - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const text = buf.subarray(0, offset).toString("utf8");
    return stats.size > size ? `${text}\n…(truncated)` : text;
  } catch (error) {
    logger.warn(`Failed to read page snapshot ${realPath}: ${error}`);
    return null;
  } finally {
    await handle?.close().catch((error) => {
      logger.warn(`Failed to close page snapshot ${realPath}: ${error}`);
    });
  }
}
