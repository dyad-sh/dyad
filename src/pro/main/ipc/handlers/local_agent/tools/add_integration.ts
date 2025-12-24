import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";

const SUPPORTED_PROVIDERS = ["supabase"] as const;

const addIntegrationSchema = z.object({
  provider: z
    .enum(SUPPORTED_PROVIDERS)
    .describe("The integration provider to add (e.g., 'supabase')"),
});

export const addIntegrationTool: ToolDefinition<
  z.infer<typeof addIntegrationSchema>
> = {
  name: "add_integration",
  description:
    "Add an integration provider to the app (e.g., Supabase for auth, database, or server-side functions). Once you have called this tool, stop and do not call any more tools because you need to wait for the user to set up the integration.",
  inputSchema: addIntegrationSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !ctx.supabaseProjectId,

  getConsentPreview: (args) => `Add ${args.provider} integration`,

  buildXml: (args, _isComplete) => {
    if (!args.provider) return undefined;
    return `<dyad-add-integration provider="${escapeXmlAttr(args.provider)}"></dyad-add-integration>`;
  },

  execute: async (args) => {
    // The actual integration setup is handled by the UI when user clicks the button
    // This tool just emits the XML that renders the integration prompt
    return `Integration prompt for ${args.provider} displayed. User can click to set up the integration.`;
  },
};
