/**
 * Citations the assistant writes into its answers.
 *
 * Retrieved passages are labelled with their file name and line range, and
 * the model is told to cite in that form. Recognising it turns those from
 * dead text into a way back to the document.
 */

export type Citation = {
  /** Whole matched text, e.g. "(Manual.pdf, lines 12–20)". */
  raw: string;
  sourceName: string;
  /** Human-readable locator, or null when the source had none. */
  locator: string | null;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  start: number;
  end: number;
};

function parseLocator(
  locator: string | undefined,
): Pick<Citation, "page" | "lineStart" | "lineEnd"> {
  const pageMatch = locator?.match(/^page\s+(\d+)$/i);
  if (pageMatch) {
    return { page: Number(pageMatch[1]), lineStart: null, lineEnd: null };
  }
  const lineMatch = locator?.match(/^lines?\s+(\d+)\s*[–—-]\s*(\d+)$/i);
  if (lineMatch) {
    return {
      page: null,
      lineStart: Number(lineMatch[1]),
      lineEnd: Number(lineMatch[2]),
    };
  }
  return { page: null, lineStart: null, lineEnd: null };
}

/**
 * Matches "(File name.ext, lines 12–20)" and "(File name.ext)".
 *
 * Requires a file extension so ordinary parenthetical asides — "(see below)"
 * — are never mistaken for citations.
 */
const CITATION_PATTERN = /\(([^()\n]+?\.[a-z0-9]{1,6})(?:,\s*([^()\n]+?))?\)/gi;

export function findCitations(text: string): Citation[] {
  if (!text) return [];
  const citations: Citation[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const [raw, sourceName, locator] = match;
    if (match.index === undefined) continue;
    citations.push({
      raw,
      sourceName: sourceName.trim(),
      locator: locator?.trim() || null,
      ...parseLocator(locator?.trim()),
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return citations;
}

export type CitationSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; citation: Citation };

/** Splits text into plain runs and citations, in order. */
export function splitByCitations(text: string): CitationSegment[] {
  const citations = findCitations(text);
  if (citations.length === 0) return [{ kind: "text", text }];

  const segments: CitationSegment[] = [];
  let cursor = 0;
  for (const citation of citations) {
    if (citation.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, citation.start) });
    }
    segments.push({ kind: "citation", citation });
    cursor = citation.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
