/**
 * P2P Inference Protocol — `/joycreate/inference/1.0.0`
 *
 * Provides direct peer-to-peer inference via libp2p streams.
 * The server side receives a request, runs it through the local Ollama bridge,
 * and returns the result.  The client side dials a specific peer and awaits
 * the response.
 *
 * Wire format:  4-byte big-endian length prefix  +  UTF-8 JSON payload
 */

import log from "electron-log";
import { getOpenClawOllamaBridge } from "./openclaw_ollama_bridge";

const logger = log.scope("p2p-inference");

export const INFERENCE_PROTOCOL = "/joycreate/inference/1.0.0";
const INFERENCE_TIMEOUT_MS = 120_000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PeerInferenceRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PeerInferenceResponse {
  content: string;
  model: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timing?: {
    totalMs: number;
    tokensPerSecond: number;
  };
}

// ─── Wire helpers ───────────────────────────────────────────────────────────

function encodeFrame(obj: unknown): Uint8Array {
  const json = JSON.stringify(obj);
  const body = new TextEncoder().encode(json);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length);
  frame.set(body, 4);
  return frame;
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  // Accumulate until we have 4 header bytes
  let buf = new Uint8Array(0);

  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf);
    next.set(chunk, buf.length);
    buf = next;
  };

  while (buf.length < 4) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Stream closed before header");
    append(value);
  }

  const payloadLen = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
  if (payloadLen > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${payloadLen}`);
  }

  while (buf.length < 4 + payloadLen) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Stream closed before payload complete");
    append(value);
  }

  const json = new TextDecoder().decode(buf.slice(4, 4 + payloadLen));
  return JSON.parse(json);
}

// ─── Server handler (runs on the peer that HAS the model) ──────────────────

/**
 * Register the inference protocol handler on a libp2p node.
 * Call this once after the node is started.
 */
export function registerInferenceHandler(libp2p: any): void {
  libp2p.handle(INFERENCE_PROTOCOL, async ({ stream }: { stream: any }) => {
    try {
      const reader = stream.source.getReader
        ? stream.source.getReader()
        : toWebReader(stream.source);

      const req = (await readFrame(reader)) as PeerInferenceRequest;
      logger.info("Received peer inference request", { model: req.model });

      // Validate request
      if (!req.model || !req.prompt) {
        const errFrame = encodeFrame({ error: "model and prompt are required" });
        await writeToSink(stream.sink, errFrame);
        return;
      }

      const ollamaBridge = getOpenClawOllamaBridge();
      if (!ollamaBridge.isOllamaAvailable()) {
        const errFrame = encodeFrame({ error: "Ollama not available on this peer" });
        await writeToSink(stream.sink, errFrame);
        return;
      }

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (req.systemPrompt) {
        messages.push({ role: "system", content: req.systemPrompt });
      }
      messages.push({ role: "user", content: req.prompt });

      const result = await ollamaBridge.inference({
        model: req.model,
        messages,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      });

      const resp: PeerInferenceResponse = {
        content: result.content,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        timing: result.timing,
      };

      const respFrame = encodeFrame(resp);
      await writeToSink(stream.sink, respFrame);
      logger.info("Peer inference completed", { model: result.model });
    } catch (err) {
      logger.error("Error handling peer inference:", err);
      try {
        const errFrame = encodeFrame({
          error: err instanceof Error ? err.message : "Internal error",
        });
        await writeToSink(stream.sink, errFrame);
      } catch {
        // stream may already be closed
      }
    }
  });

  logger.info("Registered inference protocol handler:", INFERENCE_PROTOCOL);
}

// ─── Client (dials a remote peer) ──────────────────────────────────────────

/**
 * Request inference from a remote peer.
 * Returns the peer's response or throws on timeout / error.
 */
export async function requestPeerInference(
  peerId: string,
  request: PeerInferenceRequest,
): Promise<PeerInferenceResponse> {
  // Dynamic import to avoid circular deps with compute_network_handlers
  const { getLibp2pNode } = await import("../ipc/handlers/compute_network_handlers");
  const libp2p = getLibp2pNode();
  if (!libp2p) {
    throw new Error("libp2p node not running — cannot dial peer");
  }

  const { peerIdFromString } = await import("@libp2p/peer-id");
  const remotePeer = peerIdFromString(peerId);

  logger.info("Dialing peer for inference", { peerId, model: request.model });

  const stream = await libp2p.dialProtocol(remotePeer, INFERENCE_PROTOCOL);

  // Send request
  const reqFrame = encodeFrame(request);
  await writeToSink(stream.sink, reqFrame);

  // Read response with timeout
  const reader = stream.source.getReader
    ? stream.source.getReader()
    : toWebReader(stream.source);

  const resp = await Promise.race([
    readFrame(reader) as Promise<PeerInferenceResponse & { error?: string }>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Peer inference timed out")), INFERENCE_TIMEOUT_MS),
    ),
  ]);

  if ((resp as any).error) {
    throw new Error(`Peer error: ${(resp as any).error}`);
  }

  return resp as PeerInferenceResponse;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Write a single Uint8Array to an iterable sink. */
async function writeToSink(sink: any, data: Uint8Array): Promise<void> {
  if (typeof sink === "function") {
    // libp2p iterable sink pattern
    await sink(
      (async function* () {
        yield data;
      })(),
    );
  } else if (typeof sink.write === "function") {
    // Writable stream
    await sink.write(data);
    await sink.close?.();
  }
}

/** Convert an async iterable source to a ReadableStreamDefaultReader-like interface. */
function toWebReader(source: AsyncIterable<Uint8Array>): ReadableStreamDefaultReader<Uint8Array> {
  const iter = source[Symbol.asyncIterator]();
  return {
    read: async () => {
      const { value, done } = await iter.next();
      if (done) return { value: undefined as any, done: true };
      // value might be a Uint8ArrayList – convert to Uint8Array
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value.slice?.() ?? value);
      return { value: bytes, done: false };
    },
    cancel: async () => {
      await iter.return?.();
    },
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as any;
}
