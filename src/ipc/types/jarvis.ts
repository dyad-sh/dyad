import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { JARVIS_STATES } from "../../shared/jarvis/state_machine";

// =============================================================================
// JARVIS Schemas
// =============================================================================

export const JarvisStateSchema = z.enum(JARVIS_STATES);

export const JarvisActivityEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.string(),
  type: z.enum([
    "session",
    "speech",
    "model",
    "agent",
    "tool",
    "navigation",
    "file",
    "build",
    "test",
    "image",
    "confirmation",
    "error",
  ]),
  title: z.string(),
  summary: z.string().optional(),
  status: z.enum(["queued", "running", "success", "warning", "failed"]),
  durationMs: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isUserVisible: z.boolean(),
});
export type JarvisActivityEvent = z.infer<typeof JarvisActivityEventSchema>;

export const JarvisTranscriptRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "system",
]);

export const JarvisStartSessionParamsSchema = z.object({
  sessionId: z.string(),
  /** Force the mock voice pipeline (no ElevenLabs credits consumed). */
  mock: z.boolean().optional(),
});
export type JarvisStartSessionParams = z.infer<
  typeof JarvisStartSessionParamsSchema
>;

export const JarvisStartSessionResultSchema = z.object({
  ok: z.literal(true),
  greeting: z.string(),
  /** Whether the session runs against the mock voice providers. */
  mock: z.boolean(),
  model: z.object({ provider: z.string(), name: z.string() }),
  voiceConfigured: z.boolean(),
  /** macOS microphone permission outcome; "unsupported" off macOS. */
  microphoneAccess: z.enum(["granted", "denied", "unsupported"]),
  /** Which voice engine the session started on. */
  engine: z.enum(["pipeline", "realtime"]),
  /** Sample rate the renderer must capture at for this engine. */
  captureSampleRate: z.number().int().positive(),
});

export const JarvisAudioChunkParamsSchema = z.object({
  sessionId: z.string(),
  /** Base64-encoded 16 kHz mono PCM16 audio. */
  chunk: z.string(),
});

export const JarvisTextTurnParamsSchema = z.object({
  sessionId: z.string(),
  text: z.string(),
});

export const JarvisInterruptParamsSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(["barge-in", "stop-button", "mute", "navigation"]),
});

export const JarvisSpeechActivityParamsSchema = z.object({
  sessionId: z.string(),
  kind: z.enum(["start", "end"]),
});

export const JarvisConfirmationResponseParamsSchema = z.object({
  sessionId: z.string(),
  requestId: z.string(),
  approved: z.boolean(),
});

export const OkResultSchema = z.object({ ok: z.literal(true) });

// =============================================================================
// Contracts (renderer -> main)
// =============================================================================

export const jarvisContracts = {
  startSession: defineContract({
    channel: "jarvis:session:start",
    input: JarvisStartSessionParamsSchema,
    output: JarvisStartSessionResultSchema,
  }),
  stopSession: defineContract({
    channel: "jarvis:session:stop",
    input: z.object({
      sessionId: z.string(),
      reason: z.string().optional(),
    }),
    output: OkResultSchema,
  }),
  sendAudioChunk: defineContract({
    channel: "jarvis:session:audio",
    input: JarvisAudioChunkParamsSchema,
    output: OkResultSchema,
  }),
  sendTextTurn: defineContract({
    channel: "jarvis:session:text",
    input: JarvisTextTurnParamsSchema,
    output: OkResultSchema,
  }),
  interrupt: defineContract({
    channel: "jarvis:session:interrupt",
    input: JarvisInterruptParamsSchema,
    output: OkResultSchema,
  }),
  speechActivity: defineContract({
    channel: "jarvis:session:speech-activity",
    input: JarvisSpeechActivityParamsSchema,
    output: OkResultSchema,
  }),
  /**
   * One-shot transcription for chat composers (push-to-talk), separate from
   * the live session. Audio is sent to the main process so the ElevenLabs key
   * never reaches the renderer.
   */
  transcribe: defineContract({
    channel: "jarvis:transcribe",
    input: z.object({
      /** Base64-encoded recording. */
      audio: z.string(),
      mimeType: z.string(),
    }),
    output: z.object({ text: z.string() }),
  }),
  respondToConfirmation: defineContract({
    channel: "jarvis:session:confirm",
    input: JarvisConfirmationResponseParamsSchema,
    output: OkResultSchema,
  }),
} as const;

// =============================================================================
// Events (main -> renderer)
// =============================================================================

export const jarvisEvents = {
  state: defineEvent({
    channel: "jarvis:event:state",
    payload: z.object({
      sessionId: z.string(),
      state: JarvisStateSchema,
      previous: JarvisStateSchema,
    }),
  }),
  partialTranscript: defineEvent({
    channel: "jarvis:event:partial-transcript",
    payload: z.object({ sessionId: z.string(), text: z.string() }),
  }),
  committedTranscript: defineEvent({
    channel: "jarvis:event:committed-transcript",
    payload: z.object({
      sessionId: z.string(),
      entryId: z.string(),
      role: JarvisTranscriptRoleSchema,
      text: z.string(),
    }),
  }),
  assistantDelta: defineEvent({
    channel: "jarvis:event:assistant-delta",
    payload: z.object({
      sessionId: z.string(),
      turnId: z.string(),
      delta: z.string(),
    }),
  }),
  assistantDone: defineEvent({
    channel: "jarvis:event:assistant-done",
    payload: z.object({
      sessionId: z.string(),
      turnId: z.string(),
      text: z.string(),
    }),
  }),
  /** Streaming TTS audio for playback in the renderer. */
  audioChunk: defineEvent({
    channel: "jarvis:event:audio",
    payload: z.object({
      sessionId: z.string(),
      turnId: z.string(),
      /** Base64 PCM16 mono. */
      chunk: z.string(),
      sampleRate: z.number(),
    }),
  }),
  audioDone: defineEvent({
    channel: "jarvis:event:audio-done",
    payload: z.object({ sessionId: z.string(), turnId: z.string() }),
  }),
  activity: defineEvent({
    channel: "jarvis:event:activity",
    payload: JarvisActivityEventSchema,
  }),
  confirmationRequest: defineEvent({
    channel: "jarvis:event:confirmation-request",
    payload: z.object({
      sessionId: z.string(),
      requestId: z.string(),
      message: z.string(),
    }),
  }),
  error: defineEvent({
    channel: "jarvis:event:error",
    payload: z.object({
      sessionId: z.string(),
      message: z.string(),
      recoverable: z.boolean(),
    }),
  }),
  ended: defineEvent({
    channel: "jarvis:event:ended",
    payload: z.object({ sessionId: z.string(), reason: z.string() }),
  }),
} as const;

// =============================================================================
// Clients
// =============================================================================

export const jarvisClient = createClient(jarvisContracts);
export const jarvisEventClient = createEventClient(jarvisEvents);
