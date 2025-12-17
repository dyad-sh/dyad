import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlContent,
  StreamingArgsParser,
} from "./types";

const setChatSummarySchema = z.object({
  summary: z.string().describe("A short summary/title for the chat"),
});

export const setChatSummaryTool: ToolDefinition<
  z.infer<typeof setChatSummarySchema>
> = {
  name: "set_chat_summary",
  description: "Set the title/summary for this chat",
  inputSchema: setChatSummarySchema,
  defaultConsent: "always",

  buildXml: (argsText: string, _isComplete: boolean): string | undefined => {
    const parser = new StreamingArgsParser();
    parser.push(argsText);

    const summary = parser.tryGetStringField("summary");
    if (summary === undefined) return undefined;

    return `<dyad-chat-summary>${escapeXmlContent(summary)}</dyad-chat-summary>`;
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
