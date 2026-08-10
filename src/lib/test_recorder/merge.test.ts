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

  it("keeps an earlier click on the same control, however long ago it was", () => {
    // Pairing is structural, not temporal: the gesture's own leading click is
    // what gets absorbed, so a click the user made separately is never at risk
    // no matter how the two are spaced.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 9_000, action: { kind: "click", locator: loc } },
      { at: 9_020, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "click", locator: loc },
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("absorbs the leading click even when the pair arrives slowly", () => {
    // `at` is stamped on renderer receipt, past a postMessage hop, so a busy
    // renderer can spread one gesture's two entries arbitrarily far apart. A
    // fixed merge window used to let the leading click through here, and replay
    // then performed three activations for the user's two.
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 100, action: { kind: "click", locator: loc } },
      { at: 620, action: { kind: "dblclick", locator: loc } },
    ];
    expect(collapseActions(entries)).toEqual([
      { kind: "dblclick", locator: loc },
    ]);
  });

  it("does not absorb a click separated from the double-click by another action", () => {
    const loc = { kind: "role", value: "button", name: "Open" } as const;
    const entries: RecordedEntry[] = [
      { at: 1, action: { kind: "click", locator: loc } },
      { at: 2, action: { kind: "navigate", path: "/next" } },
      { at: 3, action: { kind: "dblclick", locator: loc } },
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
        at: 1,
        action: { kind: "fill", locator: email, value: "a@example.com" },
      },
      {
        at: 2,
        action: { kind: "click", locator: placeholder("Search") },
      },
      {
        at: 3,
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
        at: 1,
        action: { kind: "fill", locator: placeholder("Email"), value: "a" },
      },
      {
        at: 2,
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
