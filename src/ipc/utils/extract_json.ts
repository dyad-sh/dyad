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

  for (let i = start; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const candidate = balancedObjectAt(text, i);
    if (candidate && isParseable(candidate)) return candidate;
  }
  // Nothing parsed. Return the widest span anyway so the caller's own
  // `JSON.parse` reports the syntax error it would have reported before.
  return widest;
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
