import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

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
 * Containment + PNG-extension check on a fully-real (symlink-resolved) path:
 * the candidate must be a `.png` (a `foo.png` symlink pointing at a
 * `.env.local` must not pass the gate) whose canonical location is directly
 * under `<appPath>/test-results/`. Uses `split` (not a string prefix) so a
 * sibling like `test-results-foo/` can't slip through. Shared by the pre-open
 * realpath check and the post-open re-validation.
 */
function isInsideTestResultsDir(
  realAppPath: string,
  candidate: string,
): boolean {
  if (path.extname(candidate).toLowerCase() !== ".png") {
    return false;
  }
  const rel = path.relative(realAppPath, candidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }
  const [firstSegment] = rel.split(path.sep);
  return firstSegment === "test-results";
}

/**
 * Read a Playwright failure screenshot as a PNG data URL, enforcing the same
 * containment guards as the `tests:screenshot` IPC handler: PNG-only, resolved
 * through symlinks, and inside the app's `test-results/` directory. Returns
 * null if the path is missing, not a PNG, or escapes the app dir.
 *
 * Shared by the IPC handler (renderer thumbnails) and the agent's run_tests
 * tool (attaching a failure screenshot to the model).
 */
export async function readTestScreenshotDataUrl(
  appPath: string,
  screenshotPath: string,
): Promise<string | null> {
  // Playwright reports absolute paths, but resolve relative ones against the
  // app dir just in case.
  const resolved = path.isAbsolute(screenshotPath)
    ? path.resolve(screenshotPath)
    : path.resolve(appPath, screenshotPath);
  if (path.extname(resolved).toLowerCase() !== ".png") {
    return null;
  }
  // No existsSync pre-check: realpath below already rejects a missing path
  // (throws → caught → null), and a separate check would open a TOCTOU window
  // where the path could be swapped for a symlink between check and resolve.
  // Resolve symlinks before the containment check: a symlink inside the app dir
  // could otherwise point outside it and pass a string-only check while the
  // read escapes. Resolve the app path too so ancestor symlinks (e.g.
  // /var -> /private/var on macOS) don't leave a `..` prefix.
  let realAppPath: string;
  let realPath: string;
  try {
    [realAppPath, realPath] = await Promise.all([
      fs.promises.realpath(appPath),
      fs.promises.realpath(resolved),
    ]);
  } catch (error) {
    logger.warn(`Failed to resolve screenshot path ${resolved}: ${error}`);
    return null;
  }
  // Re-check on the REAL (symlink-resolved) path, via the shared helper: the
  // extension (a `foo.png` symlink at a `.env.local` must not pass) plus
  // containment under `<appPath>/test-results/` (split, not a prefix, so
  // `test-results-foo/` can't slip through).
  if (!isInsideTestResultsDir(realAppPath, realPath)) {
    return null;
  }
  let handle: fs.promises.FileHandle | undefined;
  try {
    // O_NOFOLLOW only rejects a symlink in the TRAILING pathname component
    // (basename); `open(2)` still follows every ancestor component against
    // the live filesystem. So it does NOT close the TOCTOU gap between the
    // realpath check above and this open if an ancestor directory is swapped
    // to a symlink in between. The realpath + containment check is the
    // primary guard; the post-open re-validation below is defense-in-depth.
    // On Windows O_NOFOLLOW is undefined, so this falls back to 0 (no effect)
    // and the open-level guard is a no-op there — acceptable because creating
    // a symlink on Windows requires elevated privileges.
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    handle = await fs.promises.open(realPath, fs.constants.O_RDONLY | noFollow);
    // Defense-in-depth: re-verify containment of the actually-opened file.
    // The pre-open check ran against the path string, but `open()` re-resolves
    // ancestors against the live filesystem and may have followed an ancestor
    // swapped to a symlink since the realpath check. Resolve the pinned fd's
    // real path where we can, so the check reads the inode's actual location
    // and is not defeated by an ancestor swap-back race (this closes the
    // ancestor-swap window on Linux). On platforms without an fd→path lookup
    // we re-resolve the requested path string instead — this narrows the
    // window (catching a swap that persists through the open) but, unlike the
    // fd-pinned lookup, is itself raceable if the ancestor is swapped back
    // between the open and this lookup, so it does not fully close the window.
    let openedRealPath: string;
    try {
      if (process.platform === "linux" && typeof handle.fd === "number") {
        // /proc/self/fd/<fd> is a symlink to the inode the fd is pinned to, so
        // its realpath is the actually-opened file's canonical path even if
        // the filesystem is mutated afterwards.
        openedRealPath = await fs.promises.realpath(
          `/proc/self/fd/${handle.fd}`,
        );
      } else {
        openedRealPath = await fs.promises.realpath(realPath);
      }
    } catch (error) {
      logger.warn(`Failed to re-verify screenshot path ${realPath}: ${error}`);
      return null;
    }
    if (!isInsideTestResultsDir(realAppPath, openedRealPath)) {
      logger.warn(
        `Screenshot ${realPath} escaped the app dir after open; skipping`,
      );
      return null;
    }
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
