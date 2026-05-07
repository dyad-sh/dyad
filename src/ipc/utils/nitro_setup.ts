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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("nitro_setup");

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

export interface EnsureNitroResult {
  /** Non-fatal warnings produced during package install. */
  warningMessages: string[];
  /**
   * Best-effort rollback of everything this call materialized (AI_RULES patch,
   * nitro.config.ts, server/, vite.config.ts changes). Safe to call even if
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
 *   - `nitro` package installed
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
      packages: ["nitro"],
      appPath,
    });

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
