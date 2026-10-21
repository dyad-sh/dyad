import { parseFullMessage, type Block } from "@/lib/streamingMessageParser";
import type { Message } from "@/ipc/types";
import { isCancelledResponseContent } from "@/shared/chatCancellation";

/**
 * Tag the model appends to the end of a completed writable turn with short
 * follow-up prompts, one per line. The renderer shows them as clickable chips
 * above the chat input instead of rendering the tag inline.
 */
export const SUGGESTED_PROMPTS_TAG = "dyad-suggested-prompts";

export const MAX_SUGGESTED_PROMPTS = 3;

// A chip shows a single line but sends its full text, so longer prompts are
// dropped rather than sent unread.
export const MAX_SUGGESTED_PROMPT_CHARS = 120;

// Blocks the agent appends after its reply when the turn did not fully
// complete: a post-turn error such as a failed Supabase deploy, an error or
// aborted status such as a tool call that failed before running, the step limit
// pause, or an Implementer that stopped early or was cancelled.
function marksIncompleteTurn(block: Block): boolean {
  if (block.kind !== "custom-tag") return false;
  switch (block.tag) {
    case "dyad-output":
      return block.attributes.type === "error";
    case "dyad-step-limit":
      return true;
    case "dyad-status":
      return (
        block.attributes.state === "error" ||
        block.attributes.state === "aborted" ||
        /^Implementer (?:step limit|cancelled)$/.test(
          block.attributes.title ?? "",
        )
      );
    default:
      return false;
  }
}

/**
 * Whether a block may come after the suggestions in a finished reply. Only the
 * notices the agent appends after the model's last text qualify. Visible text,
 * tool cards, or reasoning mean the model kept going, so the reply did not end
 * with the suggestions.
 */
function mayFollowSuggestions(block: Block): boolean {
  if (block.kind === "markdown") return block.content.trim() === "";
  if (block.tag === "dyad-output" || block.tag === "dyad-status") {
    return block.complete && !marksIncompleteTurn(block);
  }
  return false;
}

/**
 * Extracts the follow-up prompts from a completed assistant message. Only a
 * closed, top-level tag counts, so a draft inside the model's reasoning or
 * another block is ignored, and only the last one counts, so a stray earlier
 * mention cannot win over the model's final list. Text after it means the
 * reply did not end with the suggestions, so none are offered.
 */
export function extractSuggestedPrompts(content: string): string[] {
  const { blocks } = parseFullMessage(content);
  let lastIndex = -1;
  blocks.forEach((block, index) => {
    if (
      block.kind === "custom-tag" &&
      block.tag === SUGGESTED_PROMPTS_TAG &&
      block.complete
    ) {
      lastIndex = index;
    }
  });
  if (lastIndex < 0) return [];
  if (!blocks.slice(lastIndex + 1).every(mayFollowSuggestions)) return [];

  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const rawLine of blocks[lastIndex].content.split(/\r?\n/)) {
    // Models sometimes format the list anyway ("- Add X", "1. Add X").
    const prompt = rawLine
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
      .trim();
    if (!prompt || prompt.length > MAX_SUGGESTED_PROMPT_CHARS) continue;
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
  composerHasContent = false,
}: {
  messages: readonly Message[];
  isStreaming: boolean;
  /** The last turn failed, possibly after the tag streamed, so it may be incomplete. */
  hasError?: boolean;
  /** The user is composing (typing, staging context, or using voice), so a chip would leave it behind. */
  composerHasContent?: boolean;
}): SuggestedPromptsSelection | null {
  if (isStreaming || hasError || composerHasContent) return null;
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
