import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";

import {
  installPackages,
  ExecuteAddDependencyError,
} from "@/ipc/processors/executeAddDependency";
import { appendNitroRules, restoreAiRules } from "@/ipc/utils/ai_rules_patcher";
import {
  addNitroToViteConfig,
  restoreViteConfig,
  ViteConfigBackup,
} from "@/ipc/utils/vite_config_patcher";
import { detectFrameworkType } from "@/ipc/utils/framework_utils";
import { NITRO_START_COMMAND } from "@/lib/framework_constants";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("nitro_setup");

const NITRO_DEPENDENCIES = ["nitro", "jiti"];

const NITRO_CONFIG_CONTENTS = `import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
});
`;

async function writeNitroConfigIfMissing(
  appPath: string,
): Promise<{ filePath: string; wasCreated: boolean }> {
  const filePath = path.join(appPath, "nitro.config.ts");
  try {
    await fs.access(filePath);
    return { filePath, wasCreated: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fs.writeFile(filePath, NITRO_CONFIG_CONTENTS, "utf8");
  return { filePath, wasCreated: true };
}

/**
 * The indentation a JSON file already uses, read off its first indented line.
 * Falls back to two spaces, which is what package managers write.
 */
function detectIndent(contents: string): string | number {
  const match = contents.match(/\n([ \t]+)"/);
  if (!match?.[1]) return 2;
  return match[1].startsWith("\t") ? "\t" : match[1].length;
}

/**
 * Gives the app a `start` script, because it has just become one that needs
 * starting.
 *
 * A Vite app is served as static files; adding Nitro turns it into a server
 * whose entry point is inside the build output. Nothing else in the app says
 * so, and a build pack still reads `vite.config.ts` and sees a static site.
 * Naming the entry point here is the app describing itself, which travels
 * with it anywhere it is deployed.
 *
 * Never overwrites an existing script: one that is already there describes
 * this app better than a default can.
 */
async function addStartScriptIfMissing(
  appPath: string,
): Promise<{ wasAdded: boolean; backup: string | null }> {
  const filePath = path.join(appPath, "package.json");
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { wasAdded: false, backup: null };
  }

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(contents);
  } catch {
    // A manifest that does not parse is not this step's to repair, and
    // failing here would roll back a Nitro conversion over it.
    return { wasAdded: false, backup: null };
  }
  if (typeof packageJson.scripts?.start === "string") {
    return { wasAdded: false, backup: null };
  }
  packageJson.scripts = {
    ...packageJson.scripts,
    start: NITRO_START_COMMAND,
  };
  // Written back in the file's own style. Assuming two spaces would reformat
  // a manifest committed with tabs or four, turning a one-line addition into
  // a whole-file diff that churns every later merge.
  const serialized =
    JSON.stringify(packageJson, null, detectIndent(contents)) +
    (contents.endsWith("\n") ? "\n" : "");
  // A CRLF manifest rewritten with bare newlines is a whole-file diff, which
  // is the thing preserving the indentation was meant to avoid.
  await fs.writeFile(
    filePath,
    contents.includes("\r\n") ? serialized.replace(/\n/g, "\r\n") : serialized,
    "utf8",
  );
  return { wasAdded: true, backup: contents };
}

export interface EnsureNitroResult {
  /** Non-fatal warnings produced during package install. */
  warningMessages: string[];
  /**
   * Best-effort rollback of everything this call materialized (AI_RULES patch,
   * nitro.config.ts, server/, vite.config.ts changes, the added `start`
   * script). Safe to call even if
   * the call was a no-op — it only undoes what *this* invocation added.
   * Does not uninstall the `nitro` package.
   */
  rollback: () => Promise<void>;
}

/**
 * Ensure the given Vite app has a Nitro server layer installed:
 *   - `nitro.config.ts` at the app root (`serverDir: "./server"`)
 *   - `server/routes/api/.gitkeep` to materialize the routes directory
 *   - Nitro plugin wired into `vite.config.ts`
 *   - `nitro` and `jiti` packages installed
 *   - a `start` script naming the entry point Nitro builds
 *   - "Nitro Server Layer" section appended to `AI_RULES.md`
 *
 * Idempotent: skips file/section creation if already present. Rolls back its
 * own scratch (AI_RULES patch, nitro.config.ts, server/, vite.config.ts) if
 * anything throws. Callers can also invoke the returned `rollback` if a
 * subsequent step fails and they want to undo the Nitro setup.
 */
export async function ensureNitroOnViteApp(
  appPath: string,
): Promise<EnsureNitroResult> {
  const rulesBackup = await appendNitroRules(appPath);
  let nitroConfigResult: { filePath: string; wasCreated: boolean } | null =
    null;
  let serverDirCreated = false;
  let viteConfigBackup: ViteConfigBackup | null = null;
  let startScript: { wasAdded: boolean; backup: string | null } = {
    wasAdded: false,
    backup: null,
  };
  const serverDirPath = path.join(appPath, "server");

  const rollback = async () => {
    try {
      if (rulesBackup.wasAppended) {
        await restoreAiRules(appPath, rulesBackup.backup);
      }
      if (nitroConfigResult?.wasCreated) {
        await fs.rm(nitroConfigResult.filePath, { force: true });
      }
      if (serverDirCreated) {
        await fs.rm(serverDirPath, { recursive: true, force: true });
      }
      if (viteConfigBackup) {
        await restoreViteConfig(viteConfigBackup);
      }
      if (startScript.wasAdded && startScript.backup !== null) {
        await fs.writeFile(
          path.join(appPath, "package.json"),
          startScript.backup,
          "utf8",
        );
      }
    } catch (rollbackError) {
      logger.error(
        "Rollback failed during ensureNitroOnViteApp:",
        rollbackError,
      );
    }
  };

  try {
    nitroConfigResult = await writeNitroConfigIfMissing(appPath);

    try {
      await fs.access(serverDirPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      serverDirCreated = true;
    }
    await fs.mkdir(path.join(serverDirPath, "routes", "api"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(serverDirPath, "routes", "api", ".gitkeep"),
      "",
      "utf8",
    );

    viteConfigBackup = await addNitroToViteConfig(appPath);

    const result = await installPackages({
      packages: NITRO_DEPENDENCIES,
      appPath,
    });
    // After the install, because the backup taken here is what a rollback
    // restores: taken earlier it would also revert the dependencies the
    // install just wrote, leaving package.json without nitro while
    // node_modules still has it.
    startScript = await addStartScriptIfMissing(appPath);

    return {
      warningMessages: result.warningMessages,
      rollback,
    };
  } catch (error) {
    await rollback();
    if (error instanceof ExecuteAddDependencyError) {
      throw error;
    }
    throw error;
  }
}

/**
 * Vite apps need a Nitro server layer to host server-only code (DATABASE_URL,
 * Neon client, auth secrets). This helper detects the framework, runs
 * `ensureNitroOnViteApp` when the app is Vite, and wraps any failure in a
 * `DyadError` so callers surface a clear "Nitro setup" error rather than a
 * generic provider error. Returns an empty result + no-op rollback when the
 * app is not Vite.
 */
export async function ensureNitroIfVite(
  resolvedAppPath: string,
): Promise<EnsureNitroResult> {
  if (detectFrameworkType(resolvedAppPath) !== "vite") {
    return { warningMessages: [], rollback: async () => {} };
  }
  try {
    return await ensureNitroOnViteApp(resolvedAppPath);
  } catch (nitroError: unknown) {
    const message =
      nitroError instanceof Error ? nitroError.message : String(nitroError);
    throw new DyadError(
      `Failed to set up Nitro server layer: ${message}`,
      DyadErrorKind.External,
    );
  }
}
