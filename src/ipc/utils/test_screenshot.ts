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
  // Re-check the extension on the REAL (symlink-resolved) path: a `foo.png`
  // symlink pointing at a `.env.local` would otherwise pass the initial gate.
  if (path.extname(realPath).toLowerCase() !== ".png") {
    return null;
  }
  const rel = path.relative(realAppPath, realPath);
  const insideApp =
    rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!insideApp) {
    return null;
  }
  // Only serve screenshots under `test-results/`, not any PNG in the app. Use
  // split (not a string prefix) so a sibling like `test-results-foo/` can't
  // slip through.
  const [firstSegment] = rel.split(path.sep);
  if (firstSegment !== "test-results") {
    return null;
  }
  try {
    const { size } = await fs.promises.stat(realPath);
    if (size > MAX_SCREENSHOT_BYTES) {
      logger.warn(
        `Screenshot ${realPath} is ${size} bytes (limit ${MAX_SCREENSHOT_BYTES}); skipping`,
      );
      return null;
    }
    const base64 = await fs.promises.readFile(realPath, { encoding: "base64" });
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    logger.warn(`Failed to read screenshot ${realPath}: ${error}`);
    return null;
  }
}
