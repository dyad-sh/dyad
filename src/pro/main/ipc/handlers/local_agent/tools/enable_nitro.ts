import { z } from "zod";

import { ToolDefinition, AgentContext } from "./types";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import { ensureNitroOnViteApp } from "@/ipc/utils/nitro_setup";

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

DATABASE REQUESTS: If the user is asking for a database (or anything that needs
one — auth, persistence, CRUD, etc.) and no provider is set up yet, call
\`add_integration\` FIRST and stop. Do NOT call \`enable_nitro\` in the same turn
— the user must pick their provider first. Supabase makes Nitro unnecessary.
Neon automatically sets up the Nitro server layer as part of its integration
flow, so do NOT call \`enable_nitro\` after a Neon integration either — Nitro
will already be in place when the integration completes. Only call
\`enable_nitro\` for non-database server-side needs (API routes, webhooks,
server-only secrets) when no provider is involved.
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

    try {
      const result = await ensureNitroOnViteApp(ctx.appPath);
      for (const warningMessage of result.warningMessages) {
        ctx.onWarningMessage?.(warningMessage);
      }
      ctx.frameworkType = "vite-nitro";
    } catch (error) {
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
