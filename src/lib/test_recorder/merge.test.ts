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

  it("does not merge fills to different locators", () => {
    const entries: RecordedEntry[] = [
      {
        at: 1,
        action: { kind: "fill", locator: placeholder("Email"), value: "a" },
      },
      {
        at: 2,
        action: { kind: "fill", locator: placeholder("Name"), value: "b" },
      },
    ];
    expect(collapseActions(entries)).toHaveLength(2);
  });

  it("merges a click into a following double-click on the same locator", () => {
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 300, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("does not merge a click and double-click on different locators", () => {
    const entries: RecordedEntry[] = [
      {
        at: 100,
        action: {
          kind: "click",
          locator: { kind: "role", value: "button", name: "A" },
        },
      },
      {
        at: 300,
        action: {
          kind: "dblclick",
          locator: { kind: "role", value: "button", name: "B" },
        },
      },
    ];
    expect(collapseActions(entries)).toHaveLength(2);
  });

  it("does not merge a click and double-click separated by more than 500ms", () => {
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 900, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toHaveLength(2);
  });

  it("absorbs both clicks the browser dispatches before a double-click", () => {
    // The in-page recorder reports every click as it happens (a stalled click
    // is lost when the click navigates), so a real double-click arrives as
    // click, click, dblclick — and all three must collapse to one step.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 220, action: { kind: "click", locator: loc } },
      { at: 240, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
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
