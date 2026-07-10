export type Utf8Truncation = {
  text: string;
  truncated: boolean;
};

/**
 * Return a prefix that is at most maxBytes when encoded as UTF-8. Iterating by
 * code point prevents a truncation boundary from splitting a surrogate pair.
 */
export function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  let bytes = 0;
  let result = "";
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

/** Return a UTF-8-safe suffix no larger than maxBytes. */
export function takeUtf8Suffix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  let bytes = 0;
  let start = text.length;
  while (start > 0) {
    let characterStart = start - 1;
    const lastCodeUnit = text.charCodeAt(characterStart);
    if (
      lastCodeUnit >= 0xdc00 &&
      lastCodeUnit <= 0xdfff &&
      characterStart > 0
    ) {
      const previousCodeUnit = text.charCodeAt(characterStart - 1);
      if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) {
        characterStart -= 1;
      }
    }

    const character = text.slice(characterStart, start);
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    start = characterStart;
  }

  return text.slice(start);
}

/**
 * Truncate text to an exact UTF-8 byte budget and include a suffix when space
 * permits. The returned text never contains a broken Unicode code point.
 */
export function truncateUtf8(
  text: string,
  maxBytes: number,
  suffix = "...",
): Utf8Truncation {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }

  if (maxBytes <= 0) {
    return { text: "", truncated: true };
  }

  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (suffixBytes >= maxBytes) {
    return {
      text: takeUtf8Prefix(suffix, maxBytes),
      truncated: true,
    };
  }

  return {
    text: takeUtf8Prefix(text, maxBytes - suffixBytes) + suffix,
    truncated: true,
  };
}
