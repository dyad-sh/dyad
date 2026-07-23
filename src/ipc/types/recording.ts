import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";
import { TestIsolationSchema } from "./tests";

// =============================================================================
// Recording Schemas
// =============================================================================

/**
 * Auth the recorder should establish in the preview before recording (and that
 * the generated `signIn` fixture mirrors at replay time). These are the isolated
 * test user's credentials — never privileged keys. The renderer forwards them
 * into the preview iframe so the injected auth-bootstrap can sign in via the
 * app's own endpoint (Neon) or the Supabase password grant.
 */
export const RecordingAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("neon-better-auth"),
    email: z.string(),
    password: z.string(),
  }),
  z.object({
    mode: z.literal("supabase-password"),
    email: z.string(),
    password: z.string(),
    projectUrl: z.string(),
    anonKey: z.string(),
  }),
]);
export type RecordingAuth = z.infer<typeof RecordingAuthSchema>;

export const StartRecordingParamsSchema = z.object({
  appId: z.number(),
});

export const StartRecordingResultSchema = z.object({
  appId: z.number(),
  /** How the recording session's database was isolated. */
  isolation: TestIsolationSchema,
  /** Auth to establish before recording (`{ mode: "none" }` when unavailable). */
  auth: RecordingAuthSchema,
  /**
   * Set when the session couldn't be set up (isolation failed, or another
   * operation is in progress). Recording did not start; nothing to tear down.
   */
  infraError: z.object({ message: z.string() }).optional(),
});
export type StartRecordingResult = z.infer<typeof StartRecordingResultSchema>;

export const StopRecordingParamsSchema = z.object({
  appId: z.number(),
});

// =============================================================================
// Recording Contracts
// =============================================================================

export const recordingContracts = {
  startRecording: defineContract({
    channel: "recording:start",
    input: StartRecordingParamsSchema,
    output: StartRecordingResultSchema,
  }),
  stopRecording: defineContract({
    channel: "recording:stop",
    input: StopRecordingParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

// =============================================================================
// Recording Events (main -> renderer)
// =============================================================================

export const RecordingSetupProgressPayloadSchema = z.object({
  appId: z.number(),
  message: z.string(),
});
export type RecordingSetupProgressPayload = z.infer<
  typeof RecordingSetupProgressPayloadSchema
>;

export const RecordingEndedPayloadSchema = z.object({
  appId: z.number(),
  reason: z.enum(["stopped", "app-stopped", "error"]),
  message: z.string().optional(),
});
export type RecordingEndedPayload = z.infer<typeof RecordingEndedPayloadSchema>;

export const recordingEvents = {
  setupProgress: defineEvent({
    channel: "recording:setup-progress",
    payload: RecordingSetupProgressPayloadSchema,
  }),
  ended: defineEvent({
    channel: "recording:ended",
    payload: RecordingEndedPayloadSchema,
  }),
} as const;

// =============================================================================
// Recording Client
// =============================================================================

export const recordingClient = createClient(recordingContracts);
export const recordingEventClient = createEventClient(recordingEvents);
