import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("write_plan");

const writePlanSchema = z.object({
  title: z.string().describe("Title of the implementation plan"),
  summary: z
    .string()
    .describe("Brief summary (1-2 sentences) of what will be built"),
  plan: z
    .string()
    .describe(
      "Full implementation plan in markdown format. Include sections for: feature overview, UI/UX design, considerations, technical approach, implementation steps, code changes, and testing strategy. Put product/UX sections first, technical sections last.",
    ),
});

const DESCRIPTION = `
Present an implementation plan to the user in the preview panel.

The plan should be comprehensive and include (in this order — product/UX first, technical last):
- **Overview**: Clear description of what will be built or changed
- **UI/UX Design**: User flows, layout, component placement, interactions
- **Considerations**: Potential challenges, trade-offs, edge cases, or alternatives
- **Technical Approach**: Architecture decisions, patterns to use, libraries needed
- **Implementation Steps**: Ordered, granular tasks with file-level specificity
- **Code Changes**: Specific files to modify/create and what changes are needed
- **Testing Strategy**: How the feature should be validated

Format the plan in markdown for clear readability. Use headers, bullet points, and code blocks for file paths.

After presenting the plan, the user can:
- Accept the plan (use exit_plan tool to proceed to implementation)
- Request changes (update the plan based on their feedback)

Example:
{
  "title": "User Authentication System",
  "summary": "Implement a complete authentication system with email/password login, session management, and protected routes.",
  "plan": "## Overview\\n\\nImplement a secure authentication system...\\n\\n## Technical Approach\\n\\n- Use JWT for session management...\\n\\n## Implementation Steps\\n\\n1. Create auth context...\\n2. Build login form...\\n\\n## Testing Strategy\\n\\n- Unit tests for auth hooks..."
}
`;

export const writePlanTool: ToolDefinition<z.infer<typeof writePlanSchema>> = {
  name: "write_plan",
  description: DESCRIPTION,
  inputSchema: writePlanSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Plan: ${args.title}`,

  buildXml: (args, isComplete) => {
    if (!args.title) return undefined;

    const title = escapeXmlAttr(args.title);
    const summary = args.summary ? escapeXmlAttr(args.summary) : "";

    return `<dyad-write-plan title="${title}" summary="${summary}" complete="${isComplete}"></dyad-write-plan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Writing plan: ${args.title}`);

    safeSend(ctx.event.sender, "plan:update", {
      chatId: ctx.chatId,
      title: args.title,
      summary: args.summary,
      plan: args.plan,
    });

    return `Implementation plan "${args.title}" has been presented to the user. They can review it in the preview panel and either accept it or request changes.`;
  },
};
