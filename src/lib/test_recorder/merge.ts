import type { LocatorDescriptor, RecordedAction, RecordedEntry } from "./types";

/** Max gap for a click to be absorbed into a following double-click. */
const DBLCLICK_MERGE_MS = 500;

/**
 * How close the click nearest the `dblclick` has to be before a *second* one is
 * absorbed too.
 *
 * The browser dispatches the second click and the `dblclick` back to back, so a
 * genuine pair reaches the recorder within a frame. A wider gap means the
 * recorder's own 50ms deduplication already dropped the second click, and what
 * sits before the remaining one is a separate interaction the user made —
 * absorbing it would silently delete a step from their test. Erring the other
 * way only replays one harmless extra click.
 */
const SAME_TASK_MS = 16;

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

    // A double-click arrives after the browser has already dispatched the one
    // or two clicks that compose it. Drop those, not just the last one, or the
    // spec replays a stray single click before the double-click.
    if (action.kind === "dblclick") {
      let nearestGap = 0;
      for (let absorbed = 0; absorbed < 2; absorbed++) {
        const last = out[out.length - 1];
        if (
          !last ||
          last.action.kind !== "click" ||
          !sameLocator(last.action.locator, action.locator) ||
          entry.at - last.at > DBLCLICK_MERGE_MS
        ) {
          break;
        }
        if (absorbed === 1 && nearestGap > SAME_TASK_MS) break;
        nearestGap = entry.at - last.at;
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
