/**
 * Total characters the fallback may scan, as a multiple of the response length.
 *
 * Each candidate scan is O(n), so a response built of nothing but `{"` would
 * make the fallback quadratic and freeze the main process. Budgeting the work
 * rather than capping the candidate count keeps "the first candidate that
 * parses wins" true for any response whose candidates are mostly short — which
 * is every real one — instead of abandoning the search at a fixed candidate.
 */
export const SCAN_BUDGET_FACTOR = 8;

/**
 * Slice a JSON object out of a model response.
 *
 * Models routinely wrap JSON in prose or markdown fences even when told not to,
 * so every structured one-off call runs its text through this before
 * `JSON.parse`.
 *
 * The widest span (first `{` to last `}`) is tried first, since that's what a
 * fenced object surrounded by prose looks like. When the prose itself contains
 * braces — "use `{foo}` here; result: {\"assertions\":[]}" — that span is
 * garbage, so fall back to scanning each `{` for the balanced object it opens
 * and returning the first one that actually parses.
 *
 * Returns null ONLY when the text holds no `{...}` span at all. A text that has
 * braces but nothing parseable returns the widest span rather than null, on
 * purpose: the caller's own `JSON.parse` then reports a SyntaxError naming the
 * offending content, which is a better error than a bare "no JSON found". So a
 * `if (!json)` guard means "the model wrote no object", not "the model wrote
 * valid JSON" — callers must still handle a parse failure.
 */
export function extractJson(text: string): string | null {
  return extractJsonWithScan(text).json;
}

/**
 * What the fallback scan cost, alongside its result.
 *
 * The counters exist so the linearity `SCAN_BUDGET_FACTOR` guarantees can be
 * asserted directly. Measuring it with a clock instead makes the test a report
 * on the CI runner's load — the kind of assertion that either flakes or gets
 * ignored when it fires.
 */
export interface ExtractJsonScan {
  json: string | null;
  /** `{` positions that survived `opensJsonObject` and got a balanced scan. */
  candidateScans: number;
  /** Characters those scans charged against the budget. */
  scannedChars: number;
}

export function extractJsonWithScan(text: string): ExtractJsonScan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return { json: null, candidateScans: 0, scannedChars: 0 };
  }

  const widest = text.slice(start, end + 1);
  if (isParseable(widest)) {
    return { json: widest, candidateScans: 0, scannedChars: 0 };
  }

  let budget = text.length * SCAN_BUDGET_FACTOR;
  let candidateScans = 0;
  let scannedChars = 0;
  for (let i = start; i < text.length && budget > 0; i++) {
    // Only `{` that could actually open a JSON object is worth a scan. A JSON
    // object is `{}` or `{"…`, so this rejects prose like `{foo}` on one
    // character.
    if (text[i] !== "{" || !opensJsonObject(text, i)) continue;
    // Bounded by what is left rather than charged after the fact: a candidate
    // scanned in full first could run a whole extra pass over the text past an
    // almost-exhausted budget, which is the one case the factor is there to
    // rule out.
    const { candidate, cost } = balancedObjectAt(text, i, budget);
    candidateScans++;
    scannedChars += cost;
    budget -= cost;
    if (candidate && isParseable(candidate)) {
      return { json: candidate, candidateScans, scannedChars };
    }
  }
  // Nothing parsed. Return the widest span anyway so the caller's own
  // `JSON.parse` reports the syntax error it would have reported before.
  return { json: widest, candidateScans, scannedChars };
}

/** Whether the `{` at `start` is followed by `"` or `}` (ignoring whitespace). */
function opensJsonObject(text: string, start: number): boolean {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    return ch === '"' || ch === "}";
  }
  return false;
}

function isParseable(candidate: string): boolean {
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * The `{...}` span opening at `start`, honoring string literals so a `}` inside
 * a value doesn't close the object early. Null when it never closes within
 * `limit` characters — an unclosed span and one whose close lies past the
 * remaining budget are the same answer to the caller, which stops either way.
 *
 * Returns the characters actually read, so the caller charges what it spent.
 */
function balancedObjectAt(
  text: string,
  start: number,
  limit: number,
): { candidate: string | null; cost: number } {
  let depth = 0;
  let inString = false;
  const end = Math.min(text.length, start + Math.max(limit, 0));

  for (let i = start; i < end; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { candidate: text.slice(start, i + 1), cost: i + 1 - start };
      }
    }
  }
  return { candidate: null, cost: end - start };
}
