import type { LocatorDescriptor, RecordedAction, RecordedEntry } from "./types";

/** Max gap for a click to be absorbed into a following double-click. */
const DBLCLICK_MERGE_MS = 500;

function sameLocator(a: LocatorDescriptor, b: LocatorDescriptor): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Collapse a raw recorded stream into the minimal action list a Playwright spec
 * should replay. Mirrors Playwright's `collapseActions`:
 *
 * - consecutive `fill`s to the same locator keep only the final value (typing
 *   "hello" is recorded as five growing fills but replays as one),
 * - a `click` immediately followed by a `dblclick` on the same locator collapses
 *   to the `dblclick` (defensive; the in-page recorder already stalls clicks),
 * - consecutive identical `navigate`s dedupe.
 */
export function collapseActions(entries: RecordedEntry[]): RecordedAction[] {
  const out: RecordedEntry[] = [];

  for (const entry of entries) {
    const prev = out[out.length - 1];
    const action = entry.action;

    if (prev) {
      const prevAction = prev.action;

      if (
        action.kind === "fill" &&
        prevAction.kind === "fill" &&
        sameLocator(action.locator, prevAction.locator)
      ) {
        out[out.length - 1] = entry;
        continue;
      }

      if (
        action.kind === "dblclick" &&
        prevAction.kind === "click" &&
        sameLocator(action.locator, prevAction.locator) &&
        entry.at - prev.at <= DBLCLICK_MERGE_MS
      ) {
        out[out.length - 1] = entry;
        continue;
      }

      if (
        action.kind === "navigate" &&
        prevAction.kind === "navigate" &&
        action.path === prevAction.path
      ) {
        continue;
      }
    }

    out.push(entry);
  }

  return out.map((e) => e.action);
}
