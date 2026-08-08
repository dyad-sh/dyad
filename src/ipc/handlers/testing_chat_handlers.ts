import { safeSend } from "../utils/safe_sender";
import { cleanFullResponse } from "../utils/cleanFullResponse";
import { computeStreamingPatch } from "../utils/stream_text_utils";

/**
 * Maximum number of unacked chunks the canned test stream is allowed to
 * keep in flight. The sender skips a send while
 * `lastSentSeq - lastAcked > MAX_IN_FLIGHT`, which lets the renderer's ack
 * cadence pace the stream when the renderer falls behind.
 */
const MAX_IN_FLIGHT = 1;

type ResponseEntry = string | (() => string);

function memoize(fn: () => string): () => string {
  let cached: string | undefined;
  return () => (cached ??= fn());
}

function buildStressManyWritesSmall(): string {
  return `Generating 5000 small files for stress test.

${Array.from(
  { length: 5000 },
  (_, i) =>
    `<dyad-write path="src/stress/file_${i}.ts" description="stress file ${i}">
export const id${i} = ${i};
export const name${i} = "file_${i}";
export const meta${i} = { id: id${i}, name: name${i} };
export function describe${i}() { return \`\${name${i}}:\${id${i}}\`; }
export default meta${i};
</dyad-write>`,
).join("\n")}

EOM`;
}

function buildStressManyWritesLarge(): string {
  return `Generating 10000 ~100-line files for stress test.

${Array.from({ length: 10000 }, (_, i) => {
  const fields = Array.from(
    { length: 20 },
    (_, j) => `  field_${j}: ${i * 20 + j},`,
  ).join("\n");
  const helpers = Array.from(
    { length: 20 },
    (_, j) =>
      `export function helper_${i}_${j}(x: number): number {
  return x + id${i} + ${j};
}`,
  ).join("\n");
  return `<dyad-write path="src/stress/file_${i}.ts" description="stress file ${i}">
export const id${i} = ${i};
export const name${i} = "file_${i}";

export interface Meta${i} {
  id: number;
  name: string;
  index: number;
}

export const meta${i}: Meta${i} = {
  id: id${i},
  name: name${i},
  index: ${i},
};

export const data${i} = {
${fields}
};

export function get${i}(): number {
  return id${i};
}

export function describe${i}(): string {
  return \`\${name${i}}:\${id${i}}\`;
}

${helpers}

export function summarize${i}(): string {
  const parts = [
    describe${i}(),
    String(get${i}()),
    JSON.stringify(meta${i}),
  ];
  return parts.join("|");
}

export default meta${i};
</dyad-write>`;
}).join("\n")}

EOM`;
}

// e.g. [dyad-qa=add-dep]
// Canned responses for test prompts. Stress fixtures are wrapped in
// memoized thunks so the multi-megabyte strings are only built when an
// explicit [dyad-qa=stress-...] prompt fires, not at module import.
const TEST_RESPONSES: Record<string, ResponseEntry> = {
  "ts-error": `This will get a TypeScript error.

  <dyad-write path="src/bad-file.ts" description="This will get a TypeScript error.">
  import NonExistentClass from 'non-existent-class';

  const x = new Object();
  x.nonExistentMethod();
  </dyad-write>

  EOM`,
  "add-dep": `I'll add that dependency for you.

  <dyad-add-dependency packages="deno"></dyad-add-dependency>

  EOM`,
  "add-non-existing-dep": `I'll add that dependency for you.

  <dyad-add-dependency packages="@angular/does-not-exist"></dyad-add-dependency>

  EOM`,
  "add-multiple-deps": `I'll add that dependency for you.

  <dyad-add-dependency packages="react-router-dom react-query"></dyad-add-dependency>

  EOM`,
  write: `Hello world
  <dyad-write path="src/hello.ts" content="Hello world">
  console.log("Hello world");
  </dyad-write>
  EOM`,
  "string-literal-leak": `BEFORE TAG
  <dyad-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</dyad-write>
AFTER TAG
`,
  "stress-many-writes-small": memoize(buildStressManyWritesSmall),
  "stress-many-writes-large": memoize(buildStressManyWritesLarge),
};

/**
 * Checks if a prompt is a test prompt and returns the corresponding canned response
 * @param prompt The user prompt
 * @returns The canned response if it's a test prompt, null otherwise
 */
export function getTestResponse(prompt: string): string | null {
  const match = prompt.match(/\[dyad-qa=([^\]]+)\]/);
  if (match) {
    const entry = TEST_RESPONSES[match[1]];
    if (entry === undefined) return null;
    return typeof entry === "function" ? entry() : entry;
  }
  return null;
}

/**
 * Per-stream ack state for the canned test stream backpressure path. Real
 * LLM streams do not register entries here, so `noteAck` is a no-op for
 * them.
 */
type AckEntry = { lastAcked: number };
const ackState = new Map<number, AckEntry>();

export function noteAck(chatId: number, lastSeq: number): void {
  const entry = ackState.get(chatId);
  if (!entry) return;
  if (lastSeq > entry.lastAcked) {
    entry.lastAcked = lastSeq;
  }
}

function clearAck(chatId: number): void {
  ackState.delete(chatId);
}

/**
 * Byte size of each streamed chunk. Sized to keep the 24 MB stress fixture
 * under a few thousand iterations so the loop yield + per-iter work stay
 * tractable.
 */
const CHUNK_SIZE = 500;

/**
 * Streams a canned test response to the client incrementally via tail-only
 * streaming patches, mirroring the real LLM path. The renderer applies each
 * patch to its local copy of the placeholder assistant message.
 *
 * Ack-based backpressure: each iteration appends to fullResponse and
 * increments currentSeq. The IPC send fires only while in-flight chunks
 * (`lastSentSeq - lastAcked`) are at or below MAX_IN_FLIGHT, so a slow
 * renderer naturally throttles the sender via its ack cadence.
 *
 * The 10ms loop yield lets the noteAck IPC handler run; without it, the
 * synchronous loop monopolizes the main process and acks are never
 * observed.
 *
 * `cleanFullResponse` runs once on the canned input up front. Its rewrite
 * is local to fully-formed `<dyad-*>` tags and idempotent, so the cleaned
 * full string is identical to the result of cleaning every growing prefix
 * — and pre-cleaning avoids an O(N²) regex sweep over the accumulator.
 */
export async function streamTestResponse(
  event: Electron.IpcMainInvokeEvent,
  chatId: number,
  testResponse: string,
  abortController: AbortController,
  placeholderAssistantMessageId: number,
): Promise<string> {
  console.log(`Using canned response for test prompt`);

  const cleanedResponse = cleanFullResponse(testResponse);
  let fullResponse = "";
  let lastSentContent = "";
  let currentSeq = 0;
  let lastSentSeq = 0;
  let offset = 0;

  ackState.set(chatId, { lastAcked: 0 });

  try {
    while (offset < cleanedResponse.length) {
      if (abortController.signal.aborted) break;

      const end = Math.min(offset + CHUNK_SIZE, cleanedResponse.length);
      fullResponse += cleanedResponse.slice(offset, end);
      offset = end;
      currentSeq++;

      const lastAcked = ackState.get(chatId)?.lastAcked ?? 0;
      const inFlight = lastSentSeq - lastAcked;

      if (inFlight <= MAX_IN_FLIGHT) {
        const patch = computeStreamingPatch(fullResponse, lastSentContent);
        if (patch) {
          safeSend(event.sender, "chat:response:chunk", {
            chatId,
            streamingMessageId: placeholderAssistantMessageId,
            streamingPatch: patch,
            chunkSeq: currentSeq,
          });
          lastSentContent = fullResponse;
          lastSentSeq = currentSeq;
        }
      }

      await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
    }

    // Final flush: guarantee the renderer ends with the complete response,
    // even if the last iterations were skipped due to backpressure.
    if (!abortController.signal.aborted && lastSentSeq < currentSeq) {
      const patch = computeStreamingPatch(fullResponse, lastSentContent);
      if (patch) {
        safeSend(event.sender, "chat:response:chunk", {
          chatId,
          streamingMessageId: placeholderAssistantMessageId,
          streamingPatch: patch,
          chunkSeq: currentSeq,
        });
      }
    }
  } finally {
    clearAck(chatId);
  }

  return fullResponse;
}
