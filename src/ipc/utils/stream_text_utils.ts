import type { StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";

/**
 * Computes a tail-only streaming patch from `lastSentContent` to `fullResponse`
 * using longest-common-prefix. Returns null when nothing changed.
 *
 * The renderer reconstructs the full string as `current.slice(0, offset) + content`.
 * We use LCP rather than assuming pure appends because `cleanFullResponse` may
 * retroactively rewrite bytes inside in-progress dyad-tag attribute values.
 */
export function computeStreamingPatch(
  fullResponse: string,
  lastSentContent: string,
): StreamingPatch | null {
  if (fullResponse === lastSentContent) return null;
  let lcp = 0;
  const maxLcp = Math.min(lastSentContent.length, fullResponse.length);
  while (
    lcp < maxLcp &&
    lastSentContent.charCodeAt(lcp) === fullResponse.charCodeAt(lcp)
  ) {
    lcp++;
  }
  return {
    offset: lcp,
    content: fullResponse.slice(lcp),
    // Hash the full agreed-upon prefix so the renderer can detect any stale-base
    // mismatch (e.g. a cleanFullResponse < → ＜ rewrite anywhere in the prefix).
    prefixHash: lcp > 0 ? hashPrefix(fullResponse, lcp) : undefined,
  };
}
