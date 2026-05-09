import type { StreamingPatch } from "@/ipc/types";
import { applyStreamingPatchPure } from "@/lib/applyStreamingPatch";
import {
  advanceParser,
  initialParserState,
  trimContent,
  type ParserState,
} from "@/lib/streamingMessageParser";

export interface StreamingChunkInput {
  /** Renderer-local message.content before this patch. */
  prevContent: string;
  /** Cached parser state from the previous chunk, or undefined on the first patch. */
  prevParserState: ParserState | undefined;
  /** Cumulative bytes the renderer has trimmed off the front of content. */
  prevDroppedBytes: number;
  /** Incoming streaming patch. */
  patch: StreamingPatch;
}

export type StreamingChunkResult =
  | {
      kind: "applied";
      /** New content after splice + trim. */
      content: string;
      /** New parser state (cursor / openBlock / blocks shifted to new origin). */
      parserState: ParserState;
      /** New cumulative dropped-bytes count. */
      droppedBytes: number;
    }
  | {
      /** Patch could not be applied cleanly — caller should resync. */
      kind: "mismatch";
    }
  | {
      /** Patch produced identical content. Caller can skip atom writes. */
      kind: "noop";
    };

/**
 * Pure streaming-chunk pipeline. Splices the patch into prevContent, runs
 * the incremental parser, and trims content past the open-block boundary
 * in one step. The chunk handler reads atoms, calls this, and writes the
 * result back. No side effects, no atom access — fully unit-testable.
 *
 * The trim is content-only: parser state.blocks is preserved so the
 * renderer keeps showing committed blocks. Returned droppedBytes feeds
 * the next call's offset translation.
 */
export function applyStreamingChunk({
  prevContent,
  prevParserState,
  prevDroppedBytes,
  patch,
}: StreamingChunkInput): StreamingChunkResult {
  const patched = applyStreamingPatchPure(prevContent, patch, prevDroppedBytes);
  if (!patched.applied) return { kind: "mismatch" };

  // Idempotent retransmit / no-op patch: skip parser advance and atom
  // writes. Parser state is unchanged.
  if (patched.content === prevContent && prevParserState !== undefined) {
    return { kind: "noop" };
  }

  const baseState = prevParserState ?? initialParserState();
  const advanced = advanceParser(baseState, patched.content);
  const trim = trimContent(advanced, patched.content);

  return {
    kind: "applied",
    content: trim.content,
    parserState: trim.state,
    droppedBytes: prevDroppedBytes + trim.bytesDropped,
  };
}
