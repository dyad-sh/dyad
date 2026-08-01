import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";
import { TestIsolationSchema } from "./tests";
// Relative import: this module is pulled into the preload bundle, which cannot
// resolve the "@/" alias.
import { RecordedTestDraftSchema } from "../../lib/test_recorder/draft";

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

/**
 * Hand the finished recording to the main process. Stopping does NOT write a
 * spec: the draft is parked here so the agent's `generate_test_assertions` tool
 * has the real statements to propose against, and the file is generated only
 * once the user approves a plan.
 */
export const SaveRecordedTestDraftParamsSchema = z.object({
  appId: z.number(),
  draft: RecordedTestDraftSchema,
});

export const DiscardRecordedTestDraftParamsSchema = z.object({
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
  saveRecordedTestDraft: defineContract({
    channel: "recording:save-draft",
    input: SaveRecordedTestDraftParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),
  discardRecordedTestDraft: defineContract({
    channel: "recording:discard-draft",
    input: DiscardRecordedTestDraftParamsSchema,
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
  reason: z.enum(["stopped", "app-stopped", "error", "timed-out"]),
  message: z.string().optional(),
});
export type RecordingEndedPayload = z.infer<typeof RecordingEndedPayloadSchema>;

/**
 * The parked draft has become a spec file, so the recorder's review is done.
 *
 * Emitted when the assertions card generates the test — a path that runs
 * entirely in the chat, with nothing telling the recording bar its draft is
 * spent. Without it the bar keeps offering "Save without assertions" for a
 * recording that has already been written, and taking it up produces a second,
 * suffixed copy of the same test.
 */
export const RecordingDraftConsumedPayloadSchema = z.object({
  appId: z.number(),
  specPath: z.string(),
});
export type RecordingDraftConsumedPayload = z.infer<
  typeof RecordingDraftConsumedPayloadSchema
>;

export const recordingEvents = {
  setupProgress: defineEvent({
    channel: "recording:setup-progress",
    payload: RecordingSetupProgressPayloadSchema,
  }),
  ended: defineEvent({
    channel: "recording:ended",
    payload: RecordingEndedPayloadSchema,
  }),
  draftConsumed: defineEvent({
    channel: "recording:draft-consumed",
    payload: RecordingDraftConsumedPayloadSchema,
  }),
} as const;

// =============================================================================
// Recording Client
// =============================================================================

export const recordingClient = createClient(recordingContracts);
export const recordingEventClient = createEventClient(recordingEvents);
