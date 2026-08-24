import { z } from "zod";

/**
 * Size of one app a session worked with, recorded during that session so it
 * can be reported at the next launch. Shared by the store that writes it, the
 * IPC contract that carries it, and the helpers that flatten it.
 */
export const SessionAppSizeRecordSchema = z.object({
  /** Files eligible to be sent to the AI, before per-chat context filtering. */
  fileCount: z.number().int().nonnegative(),
  /** Total bytes of those files. */
  totalBytes: z.number().int().nonnegative(),
  /** The app measured, so a session that switched apps can be identified. */
  appId: z.number().int(),
  /**
   * Distinct apps measured on this lane. Size is attributed to the last one,
   * so only single-app sessions are unambiguous; analysis can filter on this.
   */
  distinctApps: z.number().int().positive(),
  measuredAt: z.number(),
});

export type SessionAppSizeRecord = z.infer<typeof SessionAppSizeRecordSchema>;

/**
 * Two lanes, either of which may be absent. `viewed` is written on app
 * selection and measures exposure, so it covers sessions that never prompted.
 * `chatted` is written when a turn runs and measures actual work. They usually
 * name the same app; when they differ, that tells them apart.
 */
export const LastSessionRecordSchema = z.object({
  viewed: SessionAppSizeRecordSchema.optional(),
  chatted: SessionAppSizeRecordSchema.optional(),
});

export type LastSessionRecord = z.infer<typeof LastSessionRecordSchema>;

export type AppSizeLane = keyof LastSessionRecord;

function laneFields(
  prefix: string,
  record: SessionAppSizeRecord | undefined,
): Record<string, unknown> {
  if (!record) {
    // Absent rather than zeroed: a session with no app isn't a zero-size app,
    // and counting it as one would drag every bucket down.
    return { [`has_${prefix}_size`]: false };
  }
  return {
    [`has_${prefix}_size`]: true,
    [`${prefix}_file_count`]: record.fileCount,
    [`${prefix}_bytes`]: record.totalBytes,
    [`${prefix}_distinct_apps`]: record.distinctApps,
  };
}

/**
 * Flat telemetry fields for the previous session's app sizes. Shared by
 * app:initial-load (every launch, the denominator) and app:crash_detected (the
 * numerator) so both populations are measured identically. Scalars only,
 * because PostHog cannot easily filter nested JSON.
 */
export function appSizeEventFields(
  record: LastSessionRecord | null | undefined,
): Record<string, unknown> {
  const viewed = record?.viewed;
  const chatted = record?.chatted;
  return {
    ...laneFields("prev_session_viewed", viewed),
    ...laneFields("prev_session_chat", chatted),
    // Only meaningful when both lanes are present.
    ...(viewed &&
      chatted && {
        prev_session_lanes_same_app: viewed.appId === chatted.appId,
      }),
  };
}
