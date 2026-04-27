import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";
import log from "electron-log";

import { ToolDefinition, AgentContext } from "./types";
import { db } from "../../../../../../db";
import { apps } from "../../../../../../db/schema";
import {
  installPackages,
  ExecuteAddDependencyError,
} from "@/ipc/processors/executeAddDependency";
import { appendNitroRules, restoreAiRules } from "@/ipc/utils/ai_rules_patcher";

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

This tool is auto-disabled (via isEnabled) on non-Vite apps and once Nitro is
already enabled — if it appears in your toolset, it is safe and appropriate to call.

After this tool returns, follow the "Nitro Server Layer" section appended to
AI_RULES.md — it covers the required vite.config.ts changes and the conventions
for routes under server/routes/api/.
`.trim();

export const enableNitroTool: ToolDefinition<
  z.infer<typeof enableNitroSchema>
> = {
  name: "enable_nitro",
  description: ENABLE_NITRO_DESCRIPTION,
  inputSchema: enableNitroSchema,
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) => ctx.frameworkType === "vite" && !ctx.nitroEnabled,

  getConsentPreview: (args) => `Add Nitro server layer (${args.reason})`,

  buildXml: () => `<dyad-enable-nitro></dyad-enable-nitro>`,

  execute: async (_args, ctx: AgentContext) => {
    // Belt-and-suspenders: `isEnabled` already filters this tool out when
    // `ctx.nitroEnabled` is true, but we re-check here in case the LLM tries
    // to call it twice in the same turn (e.g. parallel tool calls or a retry)
    // since `ctx.nitroEnabled` is updated below after the DB write.
    if (ctx.nitroEnabled) {
      return "Nitro is already enabled for this app. Skipping setup.";
    }

    const rulesBackup = await appendNitroRules(ctx.appPath);
    let nitroConfigResult: { filePath: string; wasCreated: boolean } | null =
      null;
    let serverDirCreated = false;
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

      const result = await installPackages({
        packages: ["nitro"],
        appPath: ctx.appPath,
        dev: true,
      });
      for (const warningMessage of result.warningMessages) {
        ctx.onWarningMessage?.(warningMessage);
      }

      // Keep this as the LAST step — filesystem rollback cannot undo a
      // committed DB write.
      await db
        .update(apps)
        .set({ nitroEnabled: true })
        .where(eq(apps.id, ctx.appId));
      // Mirror the DB state on the in-memory ctx so any subsequent
      // `enable_nitro` call in the same agent turn hits the early-return
      // guard above instead of re-running install.
      ctx.nitroEnabled = true;
    } catch (error) {
      try {
        await restoreAiRules(ctx.appPath, rulesBackup.backup);
        if (nitroConfigResult?.wasCreated) {
          await fs.rm(nitroConfigResult.filePath, { force: true });
        }
        if (serverDirCreated) {
          await fs.rm(serverDirPath, { recursive: true, force: true });
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

    return "Nitro server layer added. Follow the 'Nitro Server Layer' section in AI_RULES.md to update vite.config.ts and write the requested API route(s) under server/routes/api/.";
  },
};
