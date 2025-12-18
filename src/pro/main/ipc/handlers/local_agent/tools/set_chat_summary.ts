import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";

const setChatSummarySchema = z.object({
  summary: z.string().describe("A short summary/title for the chat"),
});

export const setChatSummaryTool: ToolDefinition<
  z.infer<typeof setChatSummarySchema>
> = {
  name: "set_chat_summary",
  description:
    "Set the title/summary for this chat message. You should always call this message at the end of the turn when you have finished calling all the other tools.",
  inputSchema: setChatSummarySchema,
  defaultConsent: "always",

  buildXml: (args, _isComplete) => {
    if (args.summary == undefined) return undefined;
    return `<dyad-chat-summary>${escapeXmlContent(args.summary)}</dyad-chat-summary>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "set_chat_summary",
      toolDescription: "Set chat title",
      inputPreview: args.summary,
    });
    if (!allowed) {
      throw new Error("User denied permission for set_chat_summary");
    }

    // The actual chat title update is handled by the local_agent_handler
    // based on parsing the XML response
    return `Chat summary set to: ${args.summary}`;
  },
};
