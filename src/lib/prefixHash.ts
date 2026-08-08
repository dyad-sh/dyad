/**
 * djb2 hash of the first `length` characters of `s`.
 * Used to validate the agreed-upon prefix in streaming patches so that
 * stale-base mismatches anywhere in the prefix — not just at offset-1 — are detected.
 * Clamps `length` to `s.length` to avoid degenerate hashes from out-of-bounds access.
 */
export function hashPrefix(s: string, length: number): number {
  const safeLength = Math.min(length, s.length);
  let hash = 5381;
  for (let i = 0; i < safeLength; i++) {
    hash = (((hash << 5) + hash) ^ s.charCodeAt(i)) >>> 0;
  }
  return hash;
}
