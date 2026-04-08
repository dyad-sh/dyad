import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";

// Note: At least one property is needed because Vertex AI rejects empty parameter schemas.
// The AI SDK converts z.object({}) to undefined parameters, which Vertex AI does not accept.
const addIntegrationSchema = z.object({
  provider: z
    .enum(["supabase", "neon"])
    .optional()
    .describe(
      "Optional preferred database provider. If omitted, the user will be prompted to choose.",
    ),
});

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

  buildXml: (args, _isComplete) => {
    if (args.provider) {
      return `<dyad-add-integration provider="${escapeXmlAttr(args.provider)}"></dyad-add-integration>`;
    }
    return `<dyad-add-integration></dyad-add-integration>`;
  },

  execute: async () => {
    return "Integration prompt displayed. User will choose and set up their preferred database provider.";
  },
};
