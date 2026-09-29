import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import log from "electron-log";

const logger = log.scope("test_run_artifacts");
const OWNER_MARKER = ".dyad-test-run";
const OWNER_VERSION = "1\n";
const RUN_DIRECTORY =
  /^dyad-run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Allocation never prunes results that may still be displayed by a partial run. */
export async function createTestRunArtifactsDir(
  appPath: string,
): Promise<string> {
  const directory = path.join(
    appPath,
    "test-results",
    `dyad-run-${randomUUID()}`,
  );
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, OWNER_MARKER), OWNER_VERSION);
  return directory;
}

function reportRetentionError(error: unknown): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT" && code !== "ENOTDIR")
    logger.warn("Could not prune old test artifacts", error);
}

/** Only a completed whole-suite run may expire old, explicitly owned artifacts. */
export async function pruneTestRunArtifacts(appPath: string): Promise<void> {
  const root = path.join(appPath, "test-results");
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RUN_DIRECTORY.test(entry.name)) continue;
      const directory = path.join(root, entry.name);
      try {
        const info = await fs.lstat(directory);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          info.mtimeMs >= cutoff
        )
          continue;
        const marker = path.join(directory, OWNER_MARKER);
        if (!(await fs.lstat(marker)).isFile()) continue;
        if ((await fs.readFile(marker, "utf8")) !== OWNER_VERSION) continue;
        await fs.rm(directory, { recursive: true, force: true });
      } catch (error) {
        reportRetentionError(error);
      }
    }
  } catch (error) {
    // Retention is best effort, but permission and I/O failures stay diagnosable.
    reportRetentionError(error);
  }
}
