/**
 * Deciding what from a conversation is worth remembering forever.
 *
 * The failure mode to avoid is not missing a memory — it is writing a wrong
 * one. A missed preference costs a follow-up question; a fabricated "fact"
 * sits in Preferences.md for months, gets retrieved with confidence, and
 * quietly steers answers. So the rules here are conservative, and three of
 * them are absolute:
 *
 *  - Only the user's own words become user facts. The assistant proposing
 *    something is not the user adopting it, no matter how agreeable the reply.
 *  - Retrieved memory injected into a prompt is never re-extracted, or the
 *    vault would slowly amplify its own guesses into certainties.
 *  - Everything durable carries provenance, so any claim can be traced back
 *    to the message that produced it and re-checked by a human.
 */

export type MemoryCategory =
  | "preference"
  | "goal"
  | "fact"
  | "decision"
  | "timeline";

export type Provenance = {
  sourceConversation: string;
  sourceMessageId: string;
  createdAt: string;
  lastConfirmedAt: string;
  /** 0..1. Direct statements score high; softer phrasing scores lower. */
  confidence: number;
  status: "active" | "superseded" | "deleted";
};

export type ExtractedMemory = {
  category: MemoryCategory;
  /** The user's own wording, kept as the authoritative record. */
  statement: string;
  provenance: Provenance;
};

export type SourceMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// ── What never becomes a memory ────────────────────────────────────────────

const GREETING =
  /^\s*(hi|hey|hello|thanks|thank you|ok|okay|sure|yes|no|cool|nice|great|morning|night)\b[\s!.]*$/i;

/** Questions ask for information; they do not assert any. */
const QUESTION = /\?\s*$/;

/** Ideas floated rather than adopted. */
const SPECULATION =
  /\b(maybe|perhaps|might|could|possibly|what if|thinking about|considering|not sure|probably)\b/i;

/** Passing requests about this reply, not standing instructions. */
const ONE_OFF =
  /\b(shorter|longer|rephrase|reword|try again|say that again|in bullet|spelling|typo)\b/i;

/** The block we inject; re-extracting it would amplify our own guesses. */
const RETRIEVED_MEMORY = /<retrieved_memory>/;

/**
 * Attributes we decline to infer, even when a sentence hints at them. Storing
 * a guess about these is both unreliable and intrusive.
 */
const SENSITIVE_INFERENCE =
  /\b(religion|religious|sexuality|sexual orientation|political party|vote[ds]? for|diagnosed with|medication|mental health|ethnicity|immigration status)\b/i;

// ── What does ──────────────────────────────────────────────────────────────

/** Stable preferences: "I prefer", "I always use", "I hate". */
const PREFERENCE =
  /\b(i (?:prefer|like|love|hate|dislike|always|never|usually|generally)|my preferred|i'd rather|i want you to always)\b/i;

/** Long-running intent. */
const GOAL =
  /\b(i (?:want|plan|intend|aim) to|my goal|i'm building|i am building|working towards|i need to build)\b/i;

/** A choice actually made. */
const DECISION =
  /\b(we(?:'re| are|'ve| have)? (?:going with|decided|chosen|switching to|standardising on|standardizing on)|i(?:'ve| have)? (?:decided|chosen|picked|settled on)|let's use|we will use)\b/i;

/** Commitments and dated events. */
const TIMELINE =
  /\b(on \d{1,2}(?:st|nd|rd|th)?|next (?:week|month|monday|tuesday|wednesday|thursday|friday)|deadline|due (?:on|by)|shipped|released|launched|completed|finished)\b/i;

/** Explicit instructions to remember. */
const REMEMBER_COMMAND =
  /(?:\b(?:rem(?:em|e)?ber (?:this|that)|make a note|keep in mind|don't forget|note that)\b|^\s*(?:(?:please|i need you to)\s+)?rem(?:em|e)?ber(?:\s+(?!(?:when|how|why|where|what|who|whether)\b)|\s*:))/i;

/**
 * Whether the user is deliberately asking for durable memory.
 *
 * Natural commands such as "remember my name is Tiago" count, while recall
 * questions such as "do you remember my name?" do not. The latter must read
 * existing memory rather than accidentally writing the question as a fact.
 */
export function hasExplicitMemoryInstruction(text: string): boolean {
  return REMEMBER_COMMAND.test(text);
}

/** Explicit corrections and retractions. */
export const CORRECTION_COMMAND =
  /\b(that(?:'s| is| has) changed|no longer (?:correct|true|the case)|update (?:my|the) memory|replace the old|actually,? (?:it'?s|i)|correction)\b/i;

export const FORGET_COMMAND =
  /\b(forget (?:that|this|about)|do ?n[o']t remember (?:this|that)|delete that memory|remove that from memory)\b/i;

/**
 * Whether a message may contribute durable memory at all.
 *
 * Assistant messages never can. This is the rule that keeps the vault from
 * filling with the model's own suggestions restated as the user's positions.
 */
export function isExtractable(message: SourceMessage): boolean {
  if (message.role !== "user") return false;
  const text = message.content.trim();
  if (!text) return false;
  if (RETRIEVED_MEMORY.test(text)) return false;
  if (GREETING.test(text)) return false;
  if (ONE_OFF.test(text)) return false;
  // A question with an explicit instruction to remember is still a request to
  // remember; a bare question is not.
  if (QUESTION.test(text) && !hasExplicitMemoryInstruction(text)) return false;
  return true;
}

/** The category a statement belongs to, or null when it is not durable. */
export function categorise(text: string): MemoryCategory | null {
  if (DECISION.test(text)) return "decision";
  if (PREFERENCE.test(text)) return "preference";
  if (GOAL.test(text)) return "goal";
  if (TIMELINE.test(text)) return "timeline";
  if (hasExplicitMemoryInstruction(text)) return "fact";
  return null;
}

/**
 * How much to trust a statement.
 *
 * Hedged wording is recorded with lower confidence rather than discarded: the
 * user saying they are "probably" going with Postgres is worth knowing, but
 * should lose to a later plain statement.
 */
export function confidenceFor(text: string): number {
  const hedged = SPECULATION.test(text);
  // Being asked to remember something is not the same as being sure of it:
  // "remember I might move to Postgres" is worth keeping, but not as a fact.
  if (hasExplicitMemoryInstruction(text)) return hedged ? 0.6 : 0.95;
  return hedged ? 0.4 : 0.75;
}

/**
 * Pulls durable candidates out of a conversation.
 *
 * Returns the user's own sentences, categorised and stamped with provenance.
 * Nothing is invented and nothing is paraphrased — the statement stored is the
 * one the user actually wrote.
 */
export function extractMemories(
  messages: SourceMessage[],
  context: { conversationId: string; now?: string },
): ExtractedMemory[] {
  const timestamp = context.now ?? new Date().toISOString();
  const extracted: ExtractedMemory[] = [];

  for (const message of messages) {
    if (!isExtractable(message)) continue;

    for (const sentence of splitSentences(message.content)) {
      if (SENSITIVE_INFERENCE.test(sentence)) continue;

      const category = categorise(sentence);
      if (!category) continue;

      // Speculation only survives when the user asked for it to be kept.
      if (
        SPECULATION.test(sentence) &&
        !hasExplicitMemoryInstruction(sentence)
      ) {
        continue;
      }

      extracted.push({
        category,
        statement: sentence.trim(),
        provenance: {
          sourceConversation: context.conversationId,
          sourceMessageId: message.id,
          createdAt: timestamp,
          lastConfirmedAt: timestamp,
          confidence: confidenceFor(sentence),
          status: "active",
        },
      });
    }
  }

  return extracted;
}

/** Sentence-ish split that keeps abbreviations from cutting a line short. */
export function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, " ")
      .split(/(?<![A-Z])(?<!\be\.g)(?<!\bi\.e)[.!?]+\s+/)
      // The final sentence keeps its terminator, since nothing follows it.
      .map((part) =>
        part
          .trim()
          .replace(/[.!?]+$/, "")
          .trim(),
      )
      .filter(Boolean)
  );
}

// ── Contradictions ─────────────────────────────────────────────────────────

/** Which source wins when two memories disagree. Higher is more authoritative. */
export const AUTHORITY: Record<string, number> = {
  "current-user-statement": 7,
  "recent-user-statement": 6,
  "manually-edited": 5,
  "project-memory": 4,
  "extracted-long-term": 3,
  "generated-summary": 2,
  "raw-conversation": 1,
};

export type MemoryClaim = {
  source: keyof typeof AUTHORITY | string;
  statement: string;
  updatedAt: string;
  confidence: number;
};

/**
 * Resolves two conflicting claims, or reports that it cannot.
 *
 * The rule that matters: a generated summary never overwrites a newer direct
 * statement from the user. When authority is equal, recency decides; when
 * everything ties, the conflict is left unresolved for a human rather than
 * merged into a plausible-looking blend of two incompatible facts.
 */
export function resolveConflict(
  a: MemoryClaim,
  b: MemoryClaim,
): { winner: MemoryClaim | null; reason: string } {
  const authorityA = AUTHORITY[a.source] ?? 0;
  const authorityB = AUTHORITY[b.source] ?? 0;

  if (authorityA !== authorityB) {
    const winner = authorityA > authorityB ? a : b;
    return { winner, reason: "more authoritative source" };
  }

  const timeA = Date.parse(a.updatedAt);
  const timeB = Date.parse(b.updatedAt);
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
    return { winner: timeA > timeB ? a : b, reason: "more recent" };
  }

  if (a.confidence !== b.confidence) {
    return {
      winner: a.confidence > b.confidence ? a : b,
      reason: "higher confidence",
    };
  }

  return { winner: null, reason: "equally authoritative and equally recent" };
}
