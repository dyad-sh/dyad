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
   * Per-proxy capability the renderer must echo with `dyad-auth-login` and
   * recorder activation/deactivation messages.
   * Absent on setup failures, where no preview authentication is attempted.
   */
  authBootstrapToken: z.string().uuid().optional(),
  /**
   * Names this session. `recording:ended` carries it back so a late ending from
   * a session the renderer has already replaced can be ignored instead of
   * tearing down its successor. Absent when the session never started.
   */
  sessionId: z.string().optional(),
  /**
   * Non-fatal notice about the session itself (e.g. the preview's stored data
   * couldn't be cleared, so the recording may not start from a clean slate).
   * Recording started; this is shown alongside it.
   */
  warning: z.string().optional(),
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
  /**
   * Scope a renderer discard to the draft it actually rendered. App deletion
   * may omit this to clear all recorder state for the deleted app.
   */
  draftId: z.string().optional(),
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
  /**
   * The session this ending belongs to (see `StartRecordingResult.sessionId`).
   * Teardown takes seconds, so an ending can land after a *new* session for the
   * same app is already recording; without this the renderer would reset the UI
   * out from under it.
   */
  sessionId: z.string().optional(),
  reason: z.enum(["stopped", "app-stopped", "error", "timed-out"]),
  message: z.string().optional(),
});
export type RecordingEndedPayload = z.infer<typeof RecordingEndedPayloadSchema>;

/**
 * The parked draft has become a spec file, so the recorder's review is done.
 *
 * Emitted when the assertions card generates the test — a path that runs
 * entirely in the chat, with nothing telling the recording bar its draft is
 * spent. Without it the bar stays up offering to propose a recording that has
 * already been written, and taking it up produces a second, suffixed copy.
 */
export const RecordingDraftConsumedPayloadSchema = z.object({
  appId: z.number(),
  /** A newer recording for the same app must remain visible. */
  draftId: z.string(),
  specPath: z.string(),
});
export type RecordingDraftConsumedPayload = z.infer<
  typeof RecordingDraftConsumedPayloadSchema
>;

/**
 * The AI named the recording while proposing a test for it.
 *
 * The recorder bar holds its own copy of the draft, minted when the session
 * stopped — and for the common case (the user didn't name it) that copy has no
 * name at all. Without this the review sits there labelled "Untitled recording"
 * while the assertion card right next to it shows the name the test will
 * actually be written under.
 */
export const RecordingDraftNamedPayloadSchema = z.object({
  appId: z.number(),
  /** Scoped to one recording: a newer draft must not be renamed by an old card. */
  draftId: z.string(),
  testName: z.string(),
});
export type RecordingDraftNamedPayload = z.infer<
  typeof RecordingDraftNamedPayloadSchema
>;

export const recordingEvents = {
  draftNamed: defineEvent({
    channel: "recording:draft-named",
    payload: RecordingDraftNamedPayloadSchema,
  }),
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
