type UnknownRecord = Record<string, unknown>;

const PRESENTATION_SIGNAL = /\b(?:presentation|slide|slides|slideshow|deck)\b/i;
const SLIDE_HEADING = /^\s*(?:#{1,6}\s*)?slide\s+\d+\b/i;
const NOTES_HEADING =
  /^\s*(?:\*{0,2})?(?:speaker notes?|talk track|presenter notes?|timing)(?:\*{0,2})?\s*:/i;
const MAX_GENERATION_QUERY_LENGTH = 4_800;
const MAX_RETRY_QUERY_LENGTH = 2_400;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function removePresenterNotes(query: string) {
  const lines = query.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let skippingNotes = false;

  for (const line of lines) {
    if (NOTES_HEADING.test(line)) {
      skippingNotes = true;
      continue;
    }
    if (skippingNotes && SLIDE_HEADING.test(line)) {
      skippingNotes = false;
    }
    if (!skippingNotes) kept.push(line);
  }

  return kept.join("\n");
}

function compactQuery(query: string, maxLength: number) {
  const cleaned = removePresenterNotes(query)
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\((?:\d{1,2}:\d{2}|~?\d+\s*(?:min|mins|minutes?))\)/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  const clipped = cleaned.slice(0, maxLength - 1);
  const lastBoundary = Math.max(
    clipped.lastIndexOf("\n"),
    clipped.lastIndexOf(". "),
  );
  return `${clipped.slice(0, lastBoundary > maxLength * 0.72 ? lastBoundary : clipped.length).trim()}…`;
}

/**
 * Canva's generator receives the design brief, not the full conversation.
 * Long presentation chats often contain several obsolete outlines plus
 * speaker notes; sending all of that makes generation less reliable. Keep the
 * visual and slide plan while removing presenter-only prose and bounding the
 * request before it crosses the MCP boundary.
 */
export function prepareCanvaGenerateDesignInput(
  input: unknown,
  attempt: number,
): unknown {
  const record = asRecord(input);
  if (!record || typeof record.query !== "string") return input;

  const maxLength =
    attempt > 1 ? MAX_RETRY_QUERY_LENGTH : MAX_GENERATION_QUERY_LENGTH;
  const query = compactQuery(record.query, maxLength);

  return {
    ...record,
    ...(record.design_type == null && PRESENTATION_SIGNAL.test(query)
      ? { design_type: "presentation" }
      : {}),
    query,
  };
}
