import { z } from "zod";

/**
 * Size of the app a session worked in, recorded during that session so it can
 * be reported at the next launch. Shared by the store that writes it, the IPC
 * contract that carries it, and the helpers that flatten it.
 */
export const SessionAppSizeRecordSchema = z.object({
  /** Files eligible to be sent to the AI, before per-chat context filtering. */
  fileCount: z.number().int().nonnegative(),
  /** Total bytes of those files. */
  totalBytes: z.number().int().nonnegative(),
  /** The app measured, so a session that switched apps can be identified. */
  appId: z.number().int(),
  /**
   * Distinct apps measured this session. Size is attributed to the last one,
   * so only single-app sessions are unambiguous; analysis can filter on this.
   */
  distinctApps: z.number().int().positive(),
});

export type SessionAppSizeRecord = z.infer<typeof SessionAppSizeRecordSchema>;

/**
 * Flat telemetry fields for the previous session's app size. Shared by
 * app:initial-load (every launch, the denominator) and app:crash_detected (the
 * numerator) so both populations are measured identically. Scalars only,
 * because PostHog cannot easily filter nested JSON.
 *
 * Only sessions that ran a chat turn report a size, so both events are
 * conditioned the same way and the ratio between them still holds.
 *
 * app:initial-load fires once per window while app:crash_detected fires once
 * per session, so the absolute crash rate reads low by roughly the average
 * window count. Both size buckets are scaled the same way, so comparisons
 * between them are unaffected.
 */
export function appSizeEventFields(
  record: SessionAppSizeRecord | null | undefined,
): Record<string, unknown> {
  if (!record) {
    // Absent rather than zeroed: a session with no app isn't a zero-size app,
    // and counting it as one would drag every bucket down.
    return {};
  }
  return {
    prev_session_app_file_count: record.fileCount,
    prev_session_app_bytes: record.totalBytes,
    prev_session_distinct_apps: record.distinctApps,
  };
}
