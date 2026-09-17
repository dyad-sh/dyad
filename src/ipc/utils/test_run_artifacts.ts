import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Keep recent runs readable while another queued run produces its artifacts. */
export function createTestRunArtifactsDir(appPath: string): string {
  const root = path.join(appPath, "test-results");
  fs.mkdirSync(root, { recursive: true });
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^dyad-(run|preview)-/.test(entry.name))
      continue;
    const directory = path.join(root, entry.name);
    try {
      if (fs.statSync(directory).mtimeMs < cutoff)
        fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // Retention is best effort; it must never stop a new test run.
    }
  }
  const directory = path.join(root, `dyad-run-${randomUUID()}`);
  fs.mkdirSync(directory);
  return directory;
}
