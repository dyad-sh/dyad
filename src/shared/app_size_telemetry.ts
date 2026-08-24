import { z } from "zod";

/**
 * Size of the app a session worked in, recorded during that session so it can
 * be reported at the next launch. Shared by the store that writes it, the IPC
 * contract that carries it, and the helpers that flatten it.
 */
export const SessionAppSizeRecordSchema = z.object({
  /**
   * The most recent measurement: files eligible to be sent to the AI, before
   * per-chat context filtering, and their total bytes.
   */
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  /**
   * The largest app the session measured, and its file count. Read them as one
   * app's two dimensions, not as two independent maxima: the app is chosen by
   * bytes, so maxFileCount is that app's file count and can be lower than the
   * highest file count the session saw.
   *
   * Recent and largest differ when a session works in more than one app, or
   * when one app shrinks between turns. They argue for different things: a big
   * app touched hours ago may be irrelevant to a crash, or may still be
   * resident, since the file content cache is never cleared on an app switch.
   * Both are reported so the data can settle which one tracks crashes.
   */
  maxFileCount: z.number().int().nonnegative(),
  maxTotalBytes: z.number().int().nonnegative(),
  /** The app measured, so a session that switched apps can be identified. */
  appId: z.number().int(),
  /**
   * Distinct apps measured this session. Above one, recent and largest may
   * describe different apps, so only the largest is unambiguous.
   */
  distinctApps: z.number().int().positive(),
});

export type SessionAppSizeRecord = z.infer<typeof SessionAppSizeRecordSchema>;

/** What crosses IPC and reaches PostHog. The app id stays main-side. */
export const AppSizeTelemetrySchema = SessionAppSizeRecordSchema.omit({
  appId: true,
});

export type AppSizeTelemetry = z.infer<typeof AppSizeTelemetrySchema>;

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
 * window count. That factor cancels between size buckets only if windows per
 * session is independent of app size, which is worth checking before reading
 * anything into absolute rates.
 *
 * Names are snake_case to match app:crash_detected, which is snake_case
 * throughout. app:initial-load is otherwise camelCase, but both events have to
 * emit identical names for the comparison to work.
 */
export function appSizeEventFields(
  record: AppSizeTelemetry | null | undefined,
): Record<string, unknown> {
  if (!record) {
    // Absent rather than zeroed: a session with no app isn't a zero-size app,
    // and counting it as one would drag every bucket down.
    return {};
  }
  return {
    prev_session_app_file_count: record.fileCount,
    prev_session_app_bytes: record.totalBytes,
    prev_session_max_app_file_count: record.maxFileCount,
    prev_session_max_app_bytes: record.maxTotalBytes,
    prev_session_distinct_apps: record.distinctApps,
  };
}
