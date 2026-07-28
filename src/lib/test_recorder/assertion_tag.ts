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

/** Matches one whole `<dyad-test-assertions …>…</dyad-test-assertions>` block. */
const ASSERTIONS_TAG_BLOCK_RE = new RegExp(
  `<${ASSERTIONS_TAG}\\b[^>]*>[\\s\\S]*?</${ASSERTIONS_TAG}>`,
);

/**
 * Swap the assertions tag inside a message for `nextTag`, leaving everything
 * around it untouched. Returns null when the message has no such tag.
 *
 * The tool writes the card into the middle of the agent's assistant message, so
 * approving must splice: replacing the whole content would delete the agent's
 * prose and any other tool cards in the same message.
 */
export function replaceAssertionsTagInMessage(
  messageContent: string,
  nextTag: string,
): string | null {
  if (!ASSERTIONS_TAG_BLOCK_RE.test(messageContent)) return null;
  // Replacement is a plain string, but `$&`-style patterns in the JSON payload
  // would be interpreted by `replace`; a function replacer inserts it verbatim.
  return messageContent.replace(ASSERTIONS_TAG_BLOCK_RE, () => nextTag);
}

/** Read an attribute off a raw message containing the tag (main-process side). */
export function readAssertionsTagAttribute(
  messageContent: string,
  attribute: string,
): string | null {
  const match = new RegExp(
    `<${ASSERTIONS_TAG}\\b[^>]*\\s${attribute}="([^"]*)"`,
  ).exec(messageContent);
  return match ? match[1] : null;
}

/**
 * Extract the payload from a stored message. The main process reads back its own
 * escaped output, so unescape the two entities `escapeXmlContent` produces that
 * JSON can contain (`<`/`>` inside assertion text) plus `&` last.
 */
export function parseAssertionsPayloadFromMessage(
  messageContent: string,
): AssertionProposalPayload | null {
  const match = new RegExp(
    `<${ASSERTIONS_TAG}\\b[^>]*>([\\s\\S]*?)</${ASSERTIONS_TAG}>`,
  ).exec(messageContent);
  if (!match) return null;
  const unescaped = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return parseAssertionsPayload(unescaped);
}
