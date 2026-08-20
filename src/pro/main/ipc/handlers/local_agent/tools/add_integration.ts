import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { userInputRegistry } from "@/user_input/main";
import { getGitStateFingerprint } from "@/ipc/utils/git_utils";

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
    "Prompt the user to choose and set up a database provider for the app. Do NOT set the provider parameter unless the user explicitly names a specific provider (e.g. 'Supabase' or 'Neon') in their message. The tool blocks until the user finishes the setup and clicks Continue or chooses to skip it, then returns; you should then proceed with the next step.",
  inputSchema: addIntegrationSchema,
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) => !ctx.supabaseProjectId && !ctx.neonProjectId,

  getConsentPreview: () => "Add database integration",

  shouldTrackMutation: (_args, result) =>
    !result.startsWith("The user dismissed the integration setup") &&
    (!result.startsWith("The user skipped the integration setup") ||
      result.includes("Git-visible workspace")),
  shouldTrackFileMutation: (_args, result) =>
    result.includes("Git-visible workspace files changed during setup.") ||
    result.includes(
      "Git-visible workspace file state could not be determined during setup.",
    ),

  buildXml: (args, _isComplete) => {
    if (args.provider && args.provider !== "none") {
      return `<dyad-add-integration provider="${escapeXmlAttr(args.provider)}"></dyad-add-integration>`;
    }
    return `<dyad-add-integration></dyad-add-integration>`;
  },

  execute: async (args, ctx: AgentContext) => {
    let beforeFingerprint: string | undefined;
    let fingerprintUnknown = false;
    try {
      beforeFingerprint = await getGitStateFingerprint(
        ctx.appPath,
        ctx.abortSignal,
      );
    } catch (error) {
      fingerprintUnknown = true;
      logger.warn(
        "Could not fingerprint Git state before integration setup:",
        error,
      );
    }
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
      (result.completed && !result.provider)
    ) {
      return "The user dismissed the integration setup without completing it. Ask them how they'd like to proceed.";
    }

    let afterFingerprint: string | undefined;
    try {
      afterFingerprint = await getGitStateFingerprint(
        ctx.appPath,
        ctx.abortSignal,
      );
    } catch (error) {
      fingerprintUnknown = true;
      logger.warn(
        "Could not fingerprint Git state after integration setup:",
        error,
      );
    }
    const gitVisibleFilesChanged =
      beforeFingerprint !== undefined &&
      afterFingerprint !== undefined &&
      beforeFingerprint !== afterFingerprint;

    const mutationNote = fingerprintUnknown
      ? " Git-visible workspace file state could not be determined during setup."
      : gitVisibleFilesChanged
        ? " Git-visible workspace files changed during setup."
        : "";
    if (!result.completed && result.provider === null) {
      return `The user skipped the integration setup.${mutationNote} Continue the original task without Supabase or Neon, and do not prompt for a database integration again in this continuation.`;
    }
    if (!result.completed || !result.provider) {
      return "The user dismissed the integration setup without completing it. Ask them how they'd like to proceed.";
    }
    return `User completed the ${result.provider} integration.${mutationNote} You can now continue with the next step.`;
  },
};
