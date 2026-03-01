import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("exit_plan");

const exitPlanSchema = z.object({
  confirmation: z
    .boolean()
    .describe(
      "Whether the user has accepted the plan. Must be true to proceed.",
    ),
});

const DESCRIPTION = `
Exit planning mode after the user has accepted the implementation plan.

IMPORTANT: Only use this tool when:
1. A plan has been presented using the write_plan tool
2. The user has EXPLICITLY accepted the plan (said "yes", "accept", "looks good", etc.)
3. You are ready to begin implementation

This will:
- Switch to Agent mode for implementation
- Change the preview panel back to app preview
- Begin the implementation phase

Do NOT use this tool if:
- The user has requested changes to the plan
- The user has asked questions about the plan
- No plan has been presented yet

Example usage after user says "Looks good, let's build it!":
{
  "confirmation": true
}
`;

export const exitPlanTool: ToolDefinition<z.infer<typeof exitPlanSchema>> = {
  name: "exit_plan",
  description: DESCRIPTION,
  inputSchema: exitPlanSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: () => "Exit plan mode and start implementation",

  buildXml: (args) => {
    if (!args.confirmation) return undefined;

    return `<coney-exit-plan></coney-exit-plan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    if (!args.confirmation) {
      throw new Error("User must confirm the plan before exiting plan mode");
    }

    logger.log("Exiting plan mode, transitioning to implementation");

    safeSend(ctx.event.sender, "plan:exit", {
      chatId: ctx.chatId,
    });

    return "Plan accepted. Switching to Agent mode to begin implementation. The agreed plan will guide the implementation process.";
  },
};
