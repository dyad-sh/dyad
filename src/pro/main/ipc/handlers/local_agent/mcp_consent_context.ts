import { db } from "@/db";
import { messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

// Recent messages (~5 turns) fed to the consent classifier for intent.
const RECENT_MESSAGE_LIMIT = 10;
// User messages carry the intent that licenses an action, so keep them
// generous; assistant messages are bulk (code, tool XML) and low-signal here.
const USER_MAX_LEN = 10000;
const ASSISTANT_MAX_LEN = 1000;
// Tool output (MCP results, file reads, web fetches, etc.) is rendered into the
// assistant message content as <dyad-*> blocks. Strip them so untrusted tool
// output can't reach the classifier (injection vector).
const DYAD_TAG_RE = /<dyad-([a-z0-9-]+)\b[^>]*>[\s\S]*?<\/dyad-\1>/g;

export interface RecentTurn {
  role: "user" | "assistant";
  content: string;
}

export async function getRecentTurnsForConsent(
  chatId: number,
): Promise<RecentTurn[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id))
    .limit(RECENT_MESSAGE_LIMIT);

  // Oldest-first for the prompt.
  return rows.reverse().map((r) => {
    const cap = r.role === "user" ? USER_MAX_LEN : ASSISTANT_MAX_LEN;
    const content =
      r.role === "assistant" ? r.content.replace(DYAD_TAG_RE, "") : r.content;
    return {
      role: r.role,
      content:
        content.length > cap ? `${content.slice(0, cap)}…[truncated]` : content,
    };
  });
}

export function formatRecentTurns(turns: RecentTurn[]): string {
  return turns.map((t) => `${t.role}: ${t.content}`).join("\n\n");
}
