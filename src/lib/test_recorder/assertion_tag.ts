import {
  escapeXmlAttr,
  escapeXmlContent,
  unescapeXmlAttr,
  unescapeXmlContent,
} from "../../../shared/xmlEscape";
import {
  AssertionProposalPayloadSchema,
  type AssertionProposalPayload,
} from "./assertion_proposal";

/**
 * Serialize/deserialize the `<dyad-test-assertions>` chat card, the durable
 * store for a proposal. Approving rewrites the tag in place with
 * `status="approved"`, which is what makes the latch survive a reload. The tag
 * sits inside a larger message (the agent's prose and other tool cards surround
 * it), so every rewrite goes through `replaceAssertionsTagInMessage` — never by
 * replacing the whole message content.
 */

export const ASSERTIONS_TAG = "dyad-test-assertions";

/**
 * `discarded` is as durable as `approved` deliberately. Both are answers, and a
 * plan the user declined must not come back approvable after a reload — the
 * recording it would generate is one they already said no to.
 */
export type AssertionProposalStatus = "proposed" | "approved" | "discarded";

export function buildAssertionsTagContent({
  proposalId,
  requestId,
  status,
  payload,
}: {
  proposalId: string;
  /**
   * The parked user-input request the agent is waiting on. Present only while
   * the plan is up for review — answering it is what resumes the turn. The
   * approved rewrite drops it, so a reloaded card can't try to answer a request
   * whose stream is long gone.
   */
  requestId?: string;
  status: AssertionProposalStatus;
  payload: AssertionProposalPayload;
}): string {
  const attrs = [
    `proposal-id="${escapeXmlAttr(proposalId)}"`,
    ...(requestId ? [`request-id="${escapeXmlAttr(requestId)}"`] : []),
    `status="${status}"`,
    // Empty until the spec is generated on approve; the card falls back to the title.
    `spec-path="${escapeXmlAttr(payload.specPath ?? "")}"`,
    `state="finished"`,
  ].join(" ");
  const body = escapeXmlContent(JSON.stringify(payload, null, 2));
  return `<${ASSERTIONS_TAG} ${attrs}>\n${body}\n</${ASSERTIONS_TAG}>`;
}

/**
 * Accepts the content the streaming parser hands the card (already
 * XML-unescaped). Returns null on anything malformed so the card can render an
 * error state instead of throwing.
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
  attrs: string;
  /** The raw (still XML-escaped) tag body. */
  body: string;
}

/**
 * One assistant message can carry more than one card — the agent is free to call
 * `generate_test_assertions` twice in a turn — so every read and rewrite is
 * scoped by `proposalId`. Without it, approving the second card would read, and
 * then overwrite, the first. Omitting it returns the first card, which is what
 * the streaming renderer wants when it has no identity to match on yet.
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
 * around it untouched. The tool writes the card into the middle of the agent's
 * message, so this must splice: replacing the whole content would delete the
 * agent's prose and any other tool cards in the same message.
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

export function readAssertionsTagAttribute(
  messageContent: string,
  attribute: string,
  proposalId?: string,
): string | null {
  const found = findAssertionsTagBlock(messageContent, proposalId);
  return found ? readAttribute(found.attrs, attribute) : null;
}

export function messageHasAssertionsProposal(
  messageContent: string,
  proposalId: string,
): boolean {
  return findAssertionsTagBlock(messageContent, proposalId) !== null;
}

/**
 * The main process reads back its own escaped output, so unescape the two
 * entities `escapeXmlContent` produces that JSON can contain (`<`/`>` inside
 * assertion text) plus `&` last.
 */
export function parseAssertionsPayloadFromMessage(
  messageContent: string,
  proposalId?: string,
): AssertionProposalPayload | null {
  const found = findAssertionsTagBlock(messageContent, proposalId);
  return found ? parseAssertionsPayload(unescapeXmlContent(found.body)) : null;
}

export interface AssertionsTagSummary {
  proposalId: string;
  /** Empty once the plan settles — the rewrite drops the parked request. */
  requestId: string;
  status: AssertionProposalStatus;
  /** Empty until an approval writes the spec. */
  specPath: string;
  /**
   * The whole `<tag …>…</tag>` span. A stable identity for the plan: the
   * composer memoizes the (expensive) payload parse on this string, so a plan
   * survives the message around it being restreamed without its edits being
   * re-seeded from the server's copy.
   */
  raw: string;
}

const PROPOSAL_STATUSES = new Set<string>([
  "proposed",
  "approved",
  "discarded",
] satisfies AssertionProposalStatus[]);

/**
 * Every assertions card in a message, in document order, WITHOUT parsing the
 * payloads.
 *
 * This is how the composer finds the plan it should offer for review: the card
 * lives inside an assistant message rather than in the parked user-input
 * request, so the plan has to be read back out of the content. The scan runs
 * on every chat re-render — which during a stream is every chunk — so it stays
 * a regex over attributes and leaves the JSON to a memo keyed on `raw`.
 *
 * Only closed `<tag>…</tag>` spans match, so a card still streaming in is
 * absent here rather than half-read: the composer waits for a whole plan
 * before putting it up for review, and the chat message renders the
 * "preparing…" placeholder in the meantime.
 */
export function listAssertionsTags(
  messageContent: string,
): AssertionsTagSummary[] {
  const summaries: AssertionsTagSummary[] = [];
  const re = assertionsTagBlockRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(messageContent)) !== null) {
    const attrs = match[1];
    const status = unescapeXmlAttr(readAttribute(attrs, "status") ?? "");
    summaries.push({
      proposalId: unescapeXmlAttr(readAttribute(attrs, "proposal-id") ?? ""),
      requestId: unescapeXmlAttr(readAttribute(attrs, "request-id") ?? ""),
      // An unrecognized status is read as still up for review: the two settled
      // values are the ones that must never be inferred, since either one
      // hides a plan the user has not answered yet.
      status: PROPOSAL_STATUSES.has(status)
        ? (status as AssertionProposalStatus)
        : "proposed",
      specPath: unescapeXmlAttr(readAttribute(attrs, "spec-path") ?? ""),
      raw: match[0],
    });
  }
  return summaries;
}

/** Cheap "is there anything to scan for?" guard for the composer's hot path. */
export function messageMayHaveAssertionsTag(messageContent: string): boolean {
  return messageContent.includes(`<${ASSERTIONS_TAG}`);
}
