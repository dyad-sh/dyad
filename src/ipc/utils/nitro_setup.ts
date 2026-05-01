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
}

/**
 * Ensure the given Vite app has a Nitro server layer installed:
 *   - `nitro.config.ts` at the app root (`serverDir: "./server"`)
 *   - `server/routes/api/.gitkeep` to materialize the routes directory
 *   - `nitro` package installed
 *   - "Nitro Server Layer" section appended to `AI_RULES.md`
 *
 * Idempotent: skips file/section creation if already present. Rolls back its
 * own scratch (AI_RULES patch, nitro.config.ts, server/) if anything throws.
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
    };
  } catch (error) {
    try {
      await restoreAiRules(appPath, rulesBackup.backup);
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
    if (error instanceof ExecuteAddDependencyError) {
      throw error;
    }
    throw error;
  }
}
