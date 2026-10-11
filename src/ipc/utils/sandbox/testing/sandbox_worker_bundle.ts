import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

/**
 * Builds the sandbox worker bundle that the packaged app ships, so a test can
 * run scripts on a real worker thread instead of the in-process fallback.
 * Returns the bundle path; assign it to `DYAD_SANDBOX_WORKER_PATH` before
 * calling the runner. Each caller passes its own output directory name so
 * suites running in parallel do not overwrite each other's build.
 */
export async function buildSandboxWorkerBundle(
  outDirName: string,
): Promise<string> {
  const outDir = path.join(REPO_ROOT, ".vite", outDirName);
  const { build } = await import("vite");
  await build({
    configFile: path.join(REPO_ROOT, "vite.sandbox-worker.config.mts"),
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  const entries = await fs.readdir(outDir);
  const bundle = entries.find((name) => /^sandbox_worker\.c?js$/.test(name));
  if (!bundle) {
    throw new Error(
      `Sandbox worker bundle not found in ${outDir}: ${entries.join(", ")}`,
    );
  }
  return path.join(outDir, bundle);
}
