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
import { patchNitroViteConfig } from "./nitro_vite_config";

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

const VITE_CONFIG_FILENAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
] as const;

async function findViteConfigPath(appPath: string): Promise<string> {
  for (const fileName of VITE_CONFIG_FILENAMES) {
    const filePath = path.join(appPath, fileName);
    try {
      await fs.access(filePath);
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new DyadError(
    "Could not find vite.config.ts, vite.config.js, or vite.config.mjs.",
    DyadErrorKind.NotFound,
  );
}

async function patchViteConfigForNitro(appPath: string): Promise<{
  filePath: string;
  originalContents: string;
  patchedContents: string;
  changed: boolean;
}> {
  const filePath = await findViteConfigPath(appPath);
  const originalContents = await fs.readFile(filePath, "utf8");
  const result = patchNitroViteConfig(originalContents);

  return {
    filePath,
    originalContents,
    patchedContents: result.content,
    changed: result.changed,
  };
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

==== POST-CALL BEHAVIOR ====

This tool also updates vite.config.* for you. It adds:
     import { nitro } from "nitro/vite";

and ensures nitro(...) is the LAST Vite plugin (after react()). That ordering is
required so Nitro does not catch Vite internal module URLs like /src/*.tsx,
/@vite/client, /@react-refresh, or /@fs/* — otherwise Nitro's SPA fallback
returns index.html for those requests and the browser rejects them with a
"text/html MIME type" error, leaving the preview blank.

Example final vite.config.ts:

     import { defineConfig } from "vite";
     import react from "@vitejs/plugin-react-swc";
     import { nitro } from "nitro/vite";
     import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";

     export default defineConfig(() => ({
       plugins: [dyadComponentTagger(), react(), nitro()],
     }));

Then write the user-requested API route(s) following the conventions documented
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
    let viteConfigResult:
      | {
          filePath: string;
          originalContents: string;
          patchedContents: string;
          changed: boolean;
        }
      | undefined;

    try {
      viteConfigResult = await patchViteConfigForNitro(ctx.appPath);
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

      if (viteConfigResult.changed) {
        await fs.writeFile(
          viteConfigResult.filePath,
          viteConfigResult.patchedContents,
          "utf8",
        );
      }
    } catch (error) {
      await restoreAiRules(ctx.appPath, rulesBackup.backup);
      if (nitroConfigResult.wasCreated) {
        await fs.rm(nitroConfigResult.filePath, { force: true });
      }
      if (viteConfigResult?.changed) {
        await fs.writeFile(
          viteConfigResult.filePath,
          viteConfigResult.originalContents,
          "utf8",
        );
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

    return "Nitro server layer added and vite.config updated to place nitro() last. Now write the requested API route(s) under server/routes/api/.";
  },
};
