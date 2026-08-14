/**
 * Numbers in the HUD readout.
 *
 * The readouts are the part of the dashboard most likely to be taken at face
 * value, so a count that has not arrived shows a dash. A zero is a claim, and
 * "not loaded" is not the same claim as "none".
 */

export const UNKNOWN_READOUT = "—";

export function formatReadout(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN_READOUT;
  return value.toLocaleString();
}

/** A count against a total, e.g. "3/4" — a dash while the total is unknown. */
export function formatRatio(
  part: number | null | undefined,
  total: number | null | undefined,
): string {
  if (total === null || total === undefined) return UNKNOWN_READOUT;
  return `${part ?? 0}/${total}`;
}
