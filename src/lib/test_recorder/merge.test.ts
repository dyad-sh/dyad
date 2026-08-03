import { describe, expect, it } from "vitest";

import { collapseActions } from "./merge";
import type { RecordedEntry } from "./types";

const placeholder = (value: string) =>
  ({ kind: "placeholder", value }) as const;

describe("collapseActions", () => {
  it("keeps only the final value of consecutive fills to the same locator", () => {
    const entries: RecordedEntry[] = [
      {
        at: 1,
        action: { kind: "fill", locator: placeholder("Email"), value: "a" },
      },
      {
        at: 2,
        action: { kind: "fill", locator: placeholder("Email"), value: "ab" },
      },
      {
        at: 3,
        action: { kind: "fill", locator: placeholder("Email"), value: "abc" },
      },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "fill", locator: placeholder("Email"), value: "abc" },
    ]);
  });

  it("absorbs the click the browser dispatches before a double-click", () => {
    // The in-page recorder reports the first click as it happens (a stalled
    // click is lost when the click navigates) and drops the rest of the
    // gesture, so a real double-click arrives as click, dblclick.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 220, action: { kind: "click", locator: loc } },
      { at: 260, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("keeps a standalone click made just before a double-click", () => {
    // Each gesture contributes exactly one click, so the earlier one is a step
    // the user performed — absorbing it would silently delete it from the test,
    // however close together the two gestures were.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 300, action: { kind: "click", locator: loc } },
      { at: 330, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "click", locator: loc },
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("keeps a click on the same control that is too old to be part of the double-click", () => {
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 900, action: { kind: "click", locator: loc } },
      { at: 920, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "click", locator: loc },
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("dedupes consecutive identical navigations", () => {
    const entries: RecordedEntry[] = [
      { at: 1, action: { kind: "navigate", path: "/a" } },
      { at: 2, action: { kind: "navigate", path: "/a" } },
      { at: 3, action: { kind: "navigate", path: "/b" } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "navigate", path: "/a" },
      { kind: "navigate", path: "/b" },
    ]);
  });
});
