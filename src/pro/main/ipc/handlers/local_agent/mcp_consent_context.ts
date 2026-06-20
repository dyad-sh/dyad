import { db } from "@/db";
import { messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { parseAiMessagesJson } from "@/ipc/utils/ai_messages_utils";

// Recent messages (~5 turns) fed to the consent classifier for intent.
const RECENT_MESSAGE_LIMIT = 10;
// User messages carry the intent that licenses an action, so keep them
// generous; assistant text is lower-signal here.
const USER_MAX_LEN = 10000;
const ASSISTANT_MAX_LEN = 1000;
const TOOL_ARGS_MAX_LEN = 200;

export interface RecentTurn {
  role: "user" | "assistant";
  content: string;
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

// Compact summary of a tool call built from structured fields (not rendered
// XML), so there are no tag boundaries for tool content to break out of.
function summarizeToolCall(toolName: string, input: unknown): string {
  let args = "";
  try {
    args = typeof input === "string" ? input : JSON.stringify(input ?? "");
  } catch {
    args = "";
  }
  const empty = new Set(["", '""', "{}", "[]", "null"]);
  args = empty.has(args) ? "" : cap(args, TOOL_ARGS_MAX_LEN);
  return args ? `[ran ${toolName}: ${args}]` : `[ran ${toolName}]`;
}

// Assistant text plus a marker per tool call. Tool results (role:"tool") and
// string content are skipped so tool output never reaches the classifier.
export function assistantTrace(parsed: ModelMessage[]): string {
  const out: string[] = [];
  for (const m of parsed) {
    if (m.role !== "assistant") continue;
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part.type === "text" && typeof part.text === "string") {
        out.push(part.text);
      } else if (part.type === "tool-call") {
        out.push(summarizeToolCall(part.toolName, part.input));
      }
    }
  }
  return out.join("\n").trim();
}

export async function getRecentTurnsForConsent(
  chatId: number,
): Promise<RecentTurn[]> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      aiMessagesJson: messages.aiMessagesJson,
    })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id))
    .limit(RECENT_MESSAGE_LIMIT);

  // Oldest-first for the prompt.
  return rows.reverse().flatMap((r): RecentTurn[] => {
    if (r.role === "user") {
      return [{ role: "user", content: cap(r.content, USER_MAX_LEN) }];
    }
    const text = assistantTrace(parseAiMessagesJson(r));
    if (!text) return [];
    return [{ role: "assistant", content: cap(text, ASSISTANT_MAX_LEN) }];
  });
}

export function formatRecentTurns(turns: RecentTurn[]): string {
  if (turns.length === 0) return "(no prior messages)";
  return turns.map((t) => `${t.role}: ${t.content}`).join("\n\n");
}
