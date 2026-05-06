import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";

import { ToolDefinition, AgentContext } from "./types";
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

const logger = log.scope("enable_nitro");

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

const enableNitroSchema = z.object({
  reason: z
    .string()
    .describe(
      "One sentence explaining why server-side code is needed for this prompt.",
    ),
});

const ENABLE_NITRO_DESCRIPTION = `
Add a Nitro server layer to this Vite app so it can run secure server-side code
(API routes, database clients, secrets, webhooks).

WHEN TO CALL: Before writing any code under server/, before referencing DATABASE_URL
or any server-only env var, or when the user asks for an API route, webhook, or
server-side compute. Skip for client-side fetch with public/anon keys, for use
cases fully covered by Supabase (anon key + RLS), or when the user explicitly
says "static only" / "no backend".
`.trim();

export const enableNitroTool: ToolDefinition<
  z.infer<typeof enableNitroSchema>
> = {
  name: "enable_nitro",
  description: ENABLE_NITRO_DESCRIPTION,
  inputSchema: enableNitroSchema,
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) =>
    ctx.frameworkType === "vite" && ctx.supabaseProjectId === null,

  getConsentPreview: (args) => `Add Nitro server layer (${args.reason})`,

  buildXml: () => `<dyad-enable-nitro></dyad-enable-nitro>`,

  execute: async (_args, ctx: AgentContext) => {
    // Belt-and-suspenders: `isEnabled` already filters this tool out when
    // the framework is already "vite-nitro", but we re-check here in case the
    // LLM tries to call it twice in the same turn (e.g. parallel tool calls or
    // a retry) since `ctx.frameworkType` is updated below after install.
    if (ctx.frameworkType === "vite-nitro") {
      return "Nitro is already enabled for this app. Skipping setup.";
    }

    const rulesBackup = await appendNitroRules(ctx.appPath);
    let nitroConfigResult: { filePath: string; wasCreated: boolean } | null =
      null;
    let serverDirCreated = false;
    let viteConfigBackup: ViteConfigBackup | null = null;
    const serverDirPath = path.join(ctx.appPath, "server");

    try {
      nitroConfigResult = await writeNitroConfigIfMissing(ctx.appPath);

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

      viteConfigBackup = await addNitroToViteConfig(ctx.appPath);

      const result = await installPackages({
        packages: ["nitro"],
        appPath: ctx.appPath,
      });
      for (const warningMessage of result.warningMessages) {
        ctx.onWarningMessage?.(warningMessage);
      }

      ctx.frameworkType = "vite-nitro";
    } catch (error) {
      try {
        await restoreAiRules(ctx.appPath, rulesBackup.backup);
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
        logger.error("Rollback failed during enable_nitro:", rollbackError);
      }
      if (error instanceof ExecuteAddDependencyError) {
        for (const warningMessage of error.warningMessages) {
          ctx.onWarningMessage?.(warningMessage);
        }
      }
      throw error;
    }

    return "Nitro server layer added: vite.config.ts has been updated with the Nitro plugin, nitro.config.ts and server/routes/api/ have been created, the nitro package has been installed, and AI_RULES.md has been updated with Nitro conventions. Write the requested API route(s) under server/routes/api/ following the 'Nitro Server Layer' conventions in AI_RULES.md.";
  },
};
