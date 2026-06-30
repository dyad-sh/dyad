import log from "electron-log";
import { Output } from "ai";
import type { StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";

const logger = log.scope("stream_text_utils");

/**
 * Drop-in replacement for the AI SDK's default `Output.text()` that avoids an
 * O(n^2) cost in `streamText`'s `fullStream`.
 *
 * `streamText` always pipes `fullStream` through `createOutputTransformStream`.
 * With no `output` configured it defaults to `Output.text()`, whose
 * `parsePartialOutput` returns the whole accumulated text as `partial`. On every
 * text-delta the transform then runs `JSON.stringify(partial)` and diffs it
 * against the previous value to decide whether to emit a `partialOutput`, so
 * that stringify+diff is O(n) per chunk, O(n^2) over a long response. On large
 * multi-file generations this saturates the main process's JS thread and
 * freezes the app.
 *
 * We read `fullStream` parts directly and never consume `partialOutput`, so the
 * work is pure waste. This returns an O(1) value that still changes every chunk
 * (the text length), which keeps text flushing incrementally while making the
 * per-chunk work O(1). (Returning `undefined` would instead make text flush only
 * at block end, breaking streaming.) `responseFormat` is unchanged, so the model
 * request is identical.
 */
export function fastTextOutput(): ReturnType<typeof Output.text> {
  const base = Output.text();
  return {
    ...base,
    parsePartialOutput: async ({ text }: { text: string }) => ({
      partial: text.length,
    }),
  } as unknown as ReturnType<typeof Output.text>;
}

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

/**
 * Cancel the orphaned `baseStream` tee branch the AI SDK leaves behind
 * after `.fullStream` is read.
 *
 * Reading `.fullStream` runs the SDK's `teeStream()` synchronously: it
 * splits the SDK's internal `baseStream` into two branches and
 * reassigns the unread branch back onto `streamResult.baseStream`.
 * WhatWG `tee()` enqueues every upstream chunk into both branches'
 * controllers regardless of whether they have a reader, so the unread
 * branch's queue grows unbounded as the model streams — the dominant
 * in-flight memory leak observed in heap snapshots (`{part,
 * partialOutput}` objects parked in a `ReadableStreamDefaultController`
 * queue, rooted via the undici connection pool).
 *
 * Call this immediately after reading `.fullStream` and before the
 * stream begins pumping chunks. The cancel runs before any chunks are
 * pumped, so the orphan controller closes immediately and future
 * enqueues to it are no-ops.
 */
export function cancelOrphanedBaseStream(streamResult: unknown): void {
  const orphan: any = streamResult;
  orphan?.baseStream?.cancel?.()?.catch?.((err: unknown) => {
    logger.warn("Failed to cancel orphaned streamText baseStream branch", err);
  });
}
