import { z } from "zod";
import { ToolDefinition } from "./types";

const addIntegrationSchema = z.object({});

export const addIntegrationTool: ToolDefinition<
  z.infer<typeof addIntegrationSchema>
> = {
  name: "add_integration",
  description:
    "Prompt the user to choose and set up a database provider (Supabase or Neon) for the app. Once you have called this tool, stop and do not call any more tools because you need to wait for the user to set up the integration.",
  inputSchema: addIntegrationSchema,
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) => !ctx.supabaseProjectId && !ctx.neonProjectId,

  getConsentPreview: () => "Add database integration",

  buildXml: (_args, _isComplete) => {
    return `<dyad-add-integration></dyad-add-integration>`;
  },

  execute: async () => {
    return "Integration prompt displayed. User will choose and set up their preferred database provider.";
  },
};
