import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { userInputRegistry } from "@/user_input/main";

const logger = log.scope("add_integration");

const addIntegrationSchema = z.object({
  provider: z
    .enum(["none", "supabase", "neon"])
    .optional()
    .describe(
      "Optional preferred database provider. Use 'none' (or omit) if the user did not explicitly name a provider. Only use 'supabase' or 'neon' if the user specifically mentions that provider name in their prompt.",
    ),
});

export const addIntegrationTool: ToolDefinition<
  z.infer<typeof addIntegrationSchema>
> = {
  name: "add_integration",
  description:
    "Prompt the user to choose and set up a database provider for the app. Do NOT set the provider parameter unless the user explicitly names a specific provider (e.g. 'Supabase' or 'Neon') in their message. The tool blocks until the user finishes the setup inside the chat and clicks Continue, then returns; you should then proceed with the next step.",
  inputSchema: addIntegrationSchema,
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) => !ctx.supabaseProjectId && !ctx.neonProjectId,

  getConsentPreview: () => "Add database integration",

  shouldTrackMutation: (_args, result) =>
    !result.startsWith("The user dismissed the integration setup"),

  buildXml: (args, _isComplete) => {
    if (args.provider && args.provider !== "none") {
      return `<dyad-add-integration provider="${escapeXmlAttr(args.provider)}"></dyad-add-integration>`;
    }
    return `<dyad-add-integration></dyad-add-integration>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const provider =
      args.provider && args.provider !== "none" ? args.provider : undefined;
    const requestId = userInputRegistry.request({
      kind: "integration",
      chatId: ctx.chatId,
      provider,
      classifier: "none",
      followUpPrompt: `Continue. I have completed the ${provider ?? "database"} integration.`,
    });

    logger.log(
      `Presenting integration setup (provider: ${provider ?? "user-choice"}), requestId: ${requestId}`,
    );

    const result = await userInputRegistry.park(requestId, ctx.abortSignal);

    if (
      result?.kind !== "integration" ||
      !result.completed ||
      !result.provider
    ) {
      return "The user dismissed the integration setup without completing it. Ask them how they'd like to proceed.";
    }

    return `User completed the ${result.provider} integration. You can now continue with the next step.`;
  },
};
