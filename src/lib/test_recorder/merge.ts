import type { LocatorDescriptor, RecordedAction, RecordedEntry } from "./types";

/** Max gap for a click to be absorbed into a following double-click. */
const DBLCLICK_MERGE_MS = 500;

function sameLocator(a: LocatorDescriptor, b: LocatorDescriptor): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Collapse a raw recorded stream into the minimal action list a spec should
 * replay. Mirrors Playwright's `collapseActions`: consecutive `fill`s to the
 * same locator keep only the final value, the `click`s leading up to a
 * `dblclick` are folded into it, and identical consecutive `navigate`s dedupe.
 */
export function collapseActions(entries: RecordedEntry[]): RecordedAction[] {
  const out: RecordedEntry[] = [];

  for (const entry of entries) {
    const action = entry.action;

    // A double-click arrives after the browser has already dispatched the
    // clicks composing it, but the recorder only reports the first of them (it
    // drops any click whose `detail` says it continues a gesture). So there is
    // exactly one click to absorb here — never two, and never a click the user
    // made separately just beforehand.
    if (action.kind === "dblclick") {
      const last = out[out.length - 1];
      if (
        last &&
        last.action.kind === "click" &&
        sameLocator(last.action.locator, action.locator) &&
        entry.at - last.at <= DBLCLICK_MERGE_MS
      ) {
        out.pop();
      }
      out.push(entry);
      continue;
    }

    const prev = out[out.length - 1];

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
