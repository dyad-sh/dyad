/**
 * Total characters the fallback may scan, as a multiple of the response length.
 *
 * Each candidate scan is O(n), so a response built of nothing but `{"` would
 * make the fallback quadratic and freeze the main process. Budgeting the work
 * rather than capping the candidate count keeps "the first candidate that
 * parses wins" true for any response whose candidates are mostly short — which
 * is every real one — instead of abandoning the search at a fixed candidate.
 */
const SCAN_BUDGET_FACTOR = 8;

/**
 * Slice a JSON object out of a model response.
 *
 * Models routinely wrap JSON in prose or markdown fences even when told not to,
 * so every structured one-off call runs its text through this before
 * `JSON.parse`. Returns null when there's no parseable `{...}` span at all.
 *
 * The widest span (first `{` to last `}`) is tried first, since that's what a
 * fenced object surrounded by prose looks like. When the prose itself contains
 * braces — "use `{foo}` here; result: {\"assertions\":[]}" — that span is
 * garbage, so fall back to scanning each `{` for the balanced object it opens
 * and returning the first one that actually parses.
 */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  const widest = text.slice(start, end + 1);
  if (isParseable(widest)) return widest;

  let budget = text.length * SCAN_BUDGET_FACTOR;
  for (let i = start; i < text.length && budget > 0; i++) {
    // Only `{` that could actually open a JSON object is worth a scan. A JSON
    // object is `{}` or `{"…`, so this rejects prose like `{foo}` on one
    // character.
    if (text[i] !== "{" || !opensJsonObject(text, i)) continue;
    const candidate = balancedObjectAt(text, i);
    budget -= candidate ? candidate.length : text.length - i;
    if (candidate && isParseable(candidate)) return candidate;
  }
  // Nothing parsed. Return the widest span anyway so the caller's own
  // `JSON.parse` reports the syntax error it would have reported before.
  return widest;
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
 * a value doesn't close the object early. Null when it never closes.
 */
function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;

  for (let i = start; i < text.length; i++) {
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
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
