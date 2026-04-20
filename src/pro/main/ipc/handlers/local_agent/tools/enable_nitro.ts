import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { ToolDefinition, AgentContext } from "./types";
import { db } from "../../../../../../db";
import { apps, messages } from "../../../../../../db/schema";
import {
  executeAddDependency,
  ExecuteAddDependencyError,
} from "@/ipc/processors/executeAddDependency";
import { appendNitroRules, restoreAiRules } from "@/ipc/utils/ai_rules_patcher";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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

==== POST-CALL SETUP STEPS (you MUST perform these in the same turn) ====

After this tool returns successfully, you MUST update vite.config.ts to register
the Nitro plugin. The tool itself does NOT touch vite.config.ts because TS config
files are fragile to edit programmatically.

1. Add the import:
     import { nitro } from "nitro/vite";

2. Add nitro() to the plugins array as the LAST entry (after react()). Nitro
   must run AFTER Vite's module-transform middleware so it doesn't catch Vite
   internal URLs like /src/*.tsx, /@vite/client, /@react-refresh, or /@fs/* —
   otherwise Nitro's SPA fallback returns index.html for those requests and
   the browser rejects them with a "text/html MIME type" error, leaving the
   preview blank.

Example final vite.config.ts:

     import { defineConfig } from "vite";
     import react from "@vitejs/plugin-react-swc";
     import { nitro } from "nitro/vite";
     import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";

     export default defineConfig(() => ({
       plugins: [dyadComponentTagger(), react(), nitro()],
     }));

3. Then write the user-requested API route(s) following the conventions documented
   in AI_RULES.md — the tool appended a "Nitro Server Layer" section with route
   filesystem conventions, defineHandler usage, useRuntimeConfig patterns, and
   security rules. That is the source of truth for ongoing code.
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

  buildXml: () => `<dyad-enable-nitro />`,

  execute: async (_args, ctx: AgentContext) => {
    if (ctx.nitroEnabled) {
      return "Nitro is already enabled for this app. Skipping setup.";
    }

    const message = ctx.messageId
      ? await db.query.messages.findFirst({
          where: eq(messages.id, ctx.messageId),
        })
      : undefined;

    if (!message) {
      throw new DyadError(
        "Message not found for enabling Nitro",
        DyadErrorKind.NotFound,
      );
    }

    const rulesBackup = await appendNitroRules(ctx.appPath);
    const nitroConfigResult = await writeNitroConfigIfMissing(ctx.appPath);

    try {
      await fs.mkdir(path.join(ctx.appPath, "server", "routes", "api"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(ctx.appPath, "server", "routes", "api", ".gitkeep"),
        "",
        "utf8",
      );

      const result = await executeAddDependency({
        packages: ["nitro", "vite"],
        message,
        appPath: ctx.appPath,
      });
      for (const warningMessage of result.warningMessages) {
        ctx.onWarningMessage?.(warningMessage);
      }
    } catch (error) {
      await restoreAiRules(ctx.appPath, rulesBackup.backup);
      if (nitroConfigResult.wasCreated) {
        await fs.rm(nitroConfigResult.filePath, { force: true });
      }
      if (error instanceof ExecuteAddDependencyError) {
        for (const warningMessage of error.warningMessages) {
          ctx.onWarningMessage?.(warningMessage);
        }
      }
      throw error;
    }

    await db
      .update(apps)
      .set({ nitroEnabled: true })
      .where(eq(apps.id, ctx.appId));

    return "Nitro server layer added. Now update vite.config.ts per the setup steps in the tool description, then write the requested API route(s) under server/routes/api/.";
  },
};
