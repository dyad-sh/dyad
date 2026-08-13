import { describe, expect, it } from "vitest";

import { collapseActions } from "./merge";
import type { RecordedEntry } from "./types";

const placeholder = (value: string) =>
  ({ kind: "placeholder", value }) as const;

describe("collapseActions", () => {
  it("keeps only the final value of consecutive fills to the same locator", () => {
    const entries: RecordedEntry[] = [
      {
        action: { kind: "fill", locator: placeholder("Email"), value: "a" },
      },
      {
        action: { kind: "fill", locator: placeholder("Email"), value: "ab" },
      },
      {
        action: { kind: "fill", locator: placeholder("Email"), value: "abc" },
      },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "fill", locator: placeholder("Email"), value: "abc" },
    ]);
  });

  it("ignores source-hint changes when collapsing replay locators", () => {
    const css = "body > main > input";
    const entries: RecordedEntry[] = [
      {
        action: {
          kind: "fill",
          locator: {
            kind: "css",
            value: css,
            sourceHint: {
              relativePath: "src/App.tsx",
              line: 10,
              column: 2,
              tagName: "input",
              exact: true,
            },
          },
          value: "a",
        },
      },
      {
        action: {
          kind: "fill",
          locator: {
            kind: "css",
            value: css,
            sourceHint: {
              relativePath: "src/App.tsx",
              line: 11,
              column: 2,
              tagName: "input",
              exact: true,
            },
          },
          value: "ab",
        },
      },
    ];

    expect(collapseActions(entries)).toEqual([entries[1].action]);
  });

  it("absorbs a double-click lead-in despite changed source metadata", () => {
    const locator = {
      kind: "css" as const,
      value: "body > main > button",
      sourceHint: {
        relativePath: "src/App.tsx",
        line: 10,
        column: 2,
        tagName: "button",
        exact: true,
      },
    };
    const entries: RecordedEntry[] = [
      { action: { kind: "click", locator } },
      {
        action: {
          kind: "dblclick",
          locator: {
            ...locator,
            sourceHint: { ...locator.sourceHint, line: 11 },
          },
        },
      },
    ];

    expect(collapseActions(entries)).toEqual([entries[1].action]);
  });

  it("absorbs the click the browser dispatches before a double-click", () => {
    // The in-page recorder reports the first click as it happens (a stalled
    // click is lost when the click navigates) and drops the rest of the
    // gesture, so a real double-click arrives as click, dblclick.
    //
    // Merging is decided by that adjacency alone. Entries cross a postMessage
    // hop, so a busy renderer can spread one gesture arbitrarily far apart in
    // time; a fixed merge window used to let the leading click through, and
    // replay then performed three activations for the user's two.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { action: { kind: "click", locator: loc } },
      { action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("keeps a standalone click made before a double-click", () => {
    // Each gesture contributes exactly one click, so the earlier one is a step
    // the user performed — absorbing it would silently delete it from the test.
    // Pairing is structural, not temporal: the gesture's own leading click is
    // the one absorbed, whatever the spacing between the two gestures.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { action: { kind: "click", locator: loc } },
      { action: { kind: "click", locator: loc } },
      { action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "click", locator: loc },
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("does not absorb a click separated from the double-click by another action", () => {
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { action: { kind: "click", locator: loc } },
      { action: { kind: "navigate", path: "/next" } },
      { action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "click", locator: loc },
      { kind: "navigate", path: "/next" },
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("keeps both fills when another action separates them", () => {
    // Only *consecutive* fills collapse: an action in between means the user
    // left the field and came back, and the first value is a step of its own.
    const email = placeholder("Email");
    const entries: RecordedEntry[] = [
      {
        action: { kind: "fill", locator: email, value: "a@example.com" },
      },
      {
        action: { kind: "click", locator: placeholder("Search") },
      },
      {
        action: { kind: "fill", locator: email, value: "b@example.com" },
      },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "fill", locator: email, value: "a@example.com" },
      { kind: "click", locator: placeholder("Search") },
      { kind: "fill", locator: email, value: "b@example.com" },
    ]);
  });

  it("keeps fills to different locators", () => {
    const entries: RecordedEntry[] = [
      {
        action: { kind: "fill", locator: placeholder("Email"), value: "a" },
      },
      {
        action: { kind: "fill", locator: placeholder("Name"), value: "b" },
      },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "fill", locator: placeholder("Email"), value: "a" },
      { kind: "fill", locator: placeholder("Name"), value: "b" },
    ]);
  });

  it("dedupes consecutive identical navigations", () => {
    const entries: RecordedEntry[] = [
      { action: { kind: "navigate", path: "/a" } },
      { action: { kind: "navigate", path: "/a" } },
      { action: { kind: "navigate", path: "/b" } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "navigate", path: "/a" },
      { kind: "navigate", path: "/b" },
    ]);
  });
});
