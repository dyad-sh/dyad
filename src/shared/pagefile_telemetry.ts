import { z } from "zod";

/**
 * How the Windows pagefile is configured.
 *
 * "auto": Windows manages the size (the machine-wide setting, or a drive set
 * to "System managed size"), so the commit limit can still grow when memory
 * runs low. "fixed": every pagefile has a custom maximum, so the limit is a
 * hard ceiling. "none": no pagefile, so the limit is physical RAM.
 */
export const PagefileModeSchema = z.enum(["auto", "fixed", "none"]);
export type PagefileMode = z.infer<typeof PagefileModeSchema>;

export const PagefileSettingsSchema = z.object({
  mode: PagefileModeSchema,
  // Sum of the configured maximum sizes. Only known for fixed pagefiles.
  maxMB: z.number().optional(),
});
export type PagefileSettings = z.infer<typeof PagefileSettingsSchema>;

/**
 * Flat telemetry fields for the pagefile configuration, shared by
 * app:initial-load (every launch, the denominator) and app:crash_detected
 * (through the heartbeat snapshot), so crash rates can be compared by mode.
 */
export function pagefileEventFields(
  pagefile: PagefileSettings | null | undefined,
): Record<string, string | number> {
  if (!pagefile) {
    return {};
  }
  return {
    pagefile_mode: pagefile.mode,
    ...(pagefile.maxMB !== undefined && { pagefile_max_mb: pagefile.maxMB }),
  };
}
