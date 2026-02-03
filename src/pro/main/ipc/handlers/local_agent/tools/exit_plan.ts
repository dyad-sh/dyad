import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("exit_plan");

const exitPlanSchema = z.object({
  confirmation: z
    .literal(true)
    .describe("Must be true to confirm the user has accepted the plan"),
  implementationNotes: z
    .string()
    .optional()
    .describe("Any final notes or context for the implementation phase"),
});

const DESCRIPTION = `
Exit planning mode after the user has accepted the implementation plan.

IMPORTANT: Only use this tool when:
1. A plan has been presented using the write_plan tool
2. The user has EXPLICITLY accepted the plan (said "yes", "accept", "looks good", etc.)
3. You are ready to begin implementation

This will:
- Switch to Agent v2 mode for implementation
- Change the preview panel back to app preview
- Begin the implementation phase

Do NOT use this tool if:
- The user has requested changes to the plan
- The user has asked questions about the plan
- No plan has been presented yet

Example usage after user says "Looks good, let's build it!":
{
  "confirmation": true,
  "implementationNotes": "Starting with the auth context and login form components"
}
`;

export const exitPlanTool: ToolDefinition<z.infer<typeof exitPlanSchema>> = {
  name: "exit_plan",
  description: DESCRIPTION,
  inputSchema: exitPlanSchema,
  defaultConsent: "always",

  getConsentPreview: () => "Exit plan mode and start implementation",

  buildXml: (args) => {
    if (!args.confirmation) return undefined;

    const notesAttr = args.implementationNotes
      ? ` notes="${escapeXmlAttr(args.implementationNotes)}"`
      : "";

    return `<dyad-exit-plan${notesAttr}></dyad-exit-plan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log("Exiting plan mode, transitioning to implementation");

    safeSend(ctx.event.sender, "plan:exit", {
      chatId: ctx.chatId,
      implementationNotes: args.implementationNotes,
    });

    return "Plan accepted. Switching to Agent v2 mode to begin implementation. The agreed plan will guide the implementation process.";
  },
};
