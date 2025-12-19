import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

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

  getConsentPreview: (args) => args.summary,

  buildXml: (args, _isComplete) => {
    if (args.summary == undefined) return undefined;
    // No XML needed for this tool
    return ``;
  },

  execute: async (args, ctx: AgentContext) => {
    if (args.summary) {
      await db
        .update(chats)
        .set({ title: args.summary })
        .where(and(eq(chats.id, ctx.chatId), isNull(chats.title)));
      ctx.chatSummary = args.summary;
    }

    return `Chat summary set to: ${args.summary}`;
  },
};
