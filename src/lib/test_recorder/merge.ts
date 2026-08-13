import type { LocatorDescriptor, RecordedAction, RecordedEntry } from "./types";

function sameLocator(a: LocatorDescriptor, b: LocatorDescriptor): boolean {
  // Source hints help the agent edit app code; they never affect replay. A
  // rerender may move the same element to another source line between two
  // observations, and that metadata must not turn one replay locator into two.
  return (
    a.kind === b.kind &&
    a.value === b.value &&
    a.name === b.name &&
    a.exact === b.exact &&
    a.nth === b.nth
  );
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
    // made separately just beforehand: that earlier click is not the immediately
    // preceding entry, because this gesture's own leading click sits between
    // them.
    //
    // That structural pairing is the whole correlation, and deliberately NOT a
    // time window. `at` is stamped when the renderer receives the entry, on the
    // far side of a postMessage hop — so a gesture the browser recognized as a
    // double-click could arrive with the two entries more than any fixed
    // interval apart, and the leading click would survive into the spec. Replay
    // would then click, then double-click: three activations for the user's two.
    if (action.kind === "dblclick") {
      const last = out[out.length - 1];
      if (
        last &&
        last.action.kind === "click" &&
        sameLocator(last.action.locator, action.locator)
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
