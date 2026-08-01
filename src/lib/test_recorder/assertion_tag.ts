import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";
import {
  AssertionProposalPayloadSchema,
  type AssertionProposalPayload,
} from "./assertion_proposal";

/**
 * Serialize/deserialize the `<dyad-test-assertions>` chat card.
 *
 * The card is emitted by the agent's `generate_test_assertions` tool into its
 * assistant message, so the tag is the durable store for a proposal: attributes
 * carry the identity and approval status, the JSON body carries the plan and
 * the recording it was computed from. Approving rewrites the tag in place with
 * `status="approved"` and the path of the spec it just generated, which is what
 * makes the latch survive a reload. The tag sits inside a larger message
 * (the agent's own prose and other tool cards surround it), so every rewrite
 * goes through `replaceAssertionsTagInMessage` — never by replacing the whole
 * message content.
 */

export const ASSERTIONS_TAG = "dyad-test-assertions";

export type AssertionProposalStatus = "proposed" | "approved";

export function buildAssertionsTagContent({
  proposalId,
  status,
  payload,
}: {
  proposalId: string;
  status: AssertionProposalStatus;
  payload: AssertionProposalPayload;
}): string {
  const attrs = [
    `proposal-id="${escapeXmlAttr(proposalId)}"`,
    `status="${status}"`,
    // Empty until the spec is generated on approve — the card falls back to the
    // test title, which is all there is to show before a file exists.
    `spec-path="${escapeXmlAttr(payload.specPath ?? "")}"`,
    `state="finished"`,
  ].join(" ");
  const body = escapeXmlContent(JSON.stringify(payload, null, 2));
  return `<${ASSERTIONS_TAG} ${attrs}>\n${body}\n</${ASSERTIONS_TAG}>`;
}

/**
 * Parse the JSON body of a `<dyad-test-assertions>` tag. Accepts the content the
 * streaming parser hands the card (already XML-unescaped). Returns null on
 * anything malformed so the card can render an error state instead of throwing.
 */
export function parseAssertionsPayload(
  content: string,
): AssertionProposalPayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = AssertionProposalPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Matches every whole `<dyad-test-assertions …>…</dyad-test-assertions>` block. */
function assertionsTagBlockRe(): RegExp {
  return new RegExp(
    `<${ASSERTIONS_TAG}\\b([^>]*)>([\\s\\S]*?)</${ASSERTIONS_TAG}>`,
    "g",
  );
}

function readAttribute(openTagAttrs: string, attribute: string): string | null {
  const match = new RegExp(`\\s${attribute}="([^"]*)"`).exec(openTagAttrs);
  return match ? match[1] : null;
}

interface AssertionsTagBlock {
  /** The whole `<tag …>…</tag>` span. */
  block: string;
  /** Offset of `block` within the message. */
  index: number;
  /** The open tag's attribute text. */
  attrs: string;
  /** The raw (still XML-escaped) tag body. */
  body: string;
}

/**
 * Locate the assertions card in a message. One assistant message can carry more
 * than one card — the agent is free to call `generate_test_assertions` twice in
 * a turn — so every read and every rewrite is scoped by `proposalId`. Without
 * it, approving the second card would read, and then overwrite, the first.
 *
 * Omitting `proposalId` returns the first card, which is what the streaming
 * renderer wants when it has no identity to match on yet.
 */
function findAssertionsTagBlock(
  messageContent: string,
  proposalId?: string,
): AssertionsTagBlock | null {
  const re = assertionsTagBlockRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(messageContent)) !== null) {
    const attrs = match[1];
    if (
      proposalId === undefined ||
      readAttribute(attrs, "proposal-id") === proposalId
    ) {
      return { block: match[0], index: match.index, attrs, body: match[2] };
    }
  }
  return null;
}

/**
 * Swap one assertions tag inside a message for `nextTag`, leaving everything
 * around it untouched. Returns null when the message has no such tag (or none
 * with that `proposalId`).
 *
 * The tool writes the card into the middle of the agent's assistant message, so
 * approving must splice: replacing the whole content would delete the agent's
 * prose and any other tool cards in the same message.
 */
export function replaceAssertionsTagInMessage(
  messageContent: string,
  nextTag: string,
  proposalId?: string,
): string | null {
  const found = findAssertionsTagBlock(messageContent, proposalId);
  if (!found) return null;
  // Spliced by offset rather than `String.replace`, whose `$&`-style patterns
  // would be interpreted inside the JSON payload.
  return (
    messageContent.slice(0, found.index) +
    nextTag +
    messageContent.slice(found.index + found.block.length)
  );
}

/** Read an attribute off a raw message containing the tag (main-process side). */
export function readAssertionsTagAttribute(
  messageContent: string,
  attribute: string,
  proposalId?: string,
): string | null {
  const found = findAssertionsTagBlock(messageContent, proposalId);
  return found ? readAttribute(found.attrs, attribute) : null;
}

/** Whether the message carries a card for `proposalId`. */
export function messageHasAssertionsProposal(
  messageContent: string,
  proposalId: string,
): boolean {
  return findAssertionsTagBlock(messageContent, proposalId) !== null;
}

/**
 * Extract the payload from a stored message. The main process reads back its own
 * escaped output, so unescape the two entities `escapeXmlContent` produces that
 * JSON can contain (`<`/`>` inside assertion text) plus `&` last.
 */
export function parseAssertionsPayloadFromMessage(
  messageContent: string,
  proposalId?: string,
): AssertionProposalPayload | null {
  const found = findAssertionsTagBlock(messageContent, proposalId);
  if (!found) return null;
  const unescaped = found.body
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return parseAssertionsPayload(unescaped);
}
