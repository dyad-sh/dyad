import { unescapeXmlContent } from "../../shared/xmlEscape";
import type { Message } from "@/ipc/types";
import { isCancelledResponseContent } from "@/shared/chatCancellation";

/**
 * Tag the model appends to the end of a completed writable turn with short
 * follow-up prompts, one per line. The renderer shows them as clickable chips
 * above the chat input instead of rendering the tag inline.
 */
export const SUGGESTED_PROMPTS_TAG = "dyad-suggested-prompts";

export const MAX_SUGGESTED_PROMPTS = 3;

const SUGGESTED_PROMPTS_REGEX = new RegExp(
  `<${SUGGESTED_PROMPTS_TAG}>([\\s\\S]*?)</${SUGGESTED_PROMPTS_TAG}>`,
  "g",
);

// Markers the agent appends after its reply when the turn did not fully
// complete: a post-turn error such as a failed Supabase deploy, the step
// limit pause, or an Implementer that stopped early or was cancelled.
const INCOMPLETE_TURN_MARKER_REGEX =
  /<dyad-output\b[^>]*\btype="error"|<dyad-step-limit\b|<dyad-status\b[^>]*\btitle="Implementer (?:step limit|cancelled)"/;

/**
 * Extracts the follow-up prompts from a completed assistant message. Only the
 * last closed tag counts, so a stray earlier mention cannot win over the
 * model's final list. Returns an empty array when there is no closed tag.
 */
export function extractSuggestedPrompts(content: string): string[] {
  let lastBody: string | null = null;
  let lastEnd = 0;
  for (const match of content.matchAll(SUGGESTED_PROMPTS_REGEX)) {
    lastBody = match[1];
    lastEnd = match.index + match[0].length;
  }
  if (lastBody === null) return [];
  if (INCOMPLETE_TURN_MARKER_REGEX.test(content.slice(lastEnd))) return [];

  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const rawLine of lastBody.split(/\r?\n/)) {
    // Models sometimes format the list anyway ("- Add X", "1. Add X").
    const prompt = unescapeXmlContent(rawLine)
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
      .trim();
    if (!prompt) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    prompts.push(prompt);
    if (prompts.length >= MAX_SUGGESTED_PROMPTS) break;
  }
  return prompts;
}

export interface SuggestedPromptsSelection {
  /** The assistant message the prompts were read from. */
  messageId: number;
  prompts: string[];
}

/**
 * Picks the follow-up prompts to offer for a chat: the ones on the latest
 * message, and only while that message is a settled assistant reply. As soon
 * as the user sends anything the last message is theirs and the chips go away.
 */
export function selectSuggestedPrompts({
  messages,
  isStreaming,
  hasError = false,
}: {
  messages: readonly Message[];
  isStreaming: boolean;
  /** The last turn failed, possibly after the tag streamed, so it may be incomplete. */
  hasError?: boolean;
}): SuggestedPromptsSelection | null {
  if (isStreaming || hasError) return null;
  const last = messages.at(-1);
  if (
    !last ||
    last.role !== "assistant" ||
    last.approvalState === "rejected" ||
    isCancelledResponseContent(last.content)
  ) {
    return null;
  }
  const prompts = extractSuggestedPrompts(last.content);
  if (prompts.length === 0) return null;
  return { messageId: last.id, prompts };
}
