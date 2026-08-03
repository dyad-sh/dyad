import { describe, expect, it } from "vitest";

import { parseRecorderAction } from "./types";

// `parseRecorderAction` is the trust boundary: everything it accepts comes from
// the previewed app's frame and ends up in a spec file in the user's repo.
describe("parseRecorderAction", () => {
  it("accepts an app-relative navigation", () => {
    expect(
      parseRecorderAction({ kind: "navigate", path: "/items?page=2" }),
    ).toEqual({ kind: "navigate", path: "/items?page=2" });
  });

  it("rejects a navigation that leaves the app", () => {
    // `page.goto("https://evil.example")` in a generated test would send the
    // user's own test run somewhere they never recorded.
    expect(
      parseRecorderAction({ kind: "navigate", path: "https://evil.example/x" }),
    ).toBeNull();
    // Protocol-relative is off-origin too once Playwright resolves it.
    expect(
      parseRecorderAction({ kind: "navigate", path: "//evil.example/x" }),
    ).toBeNull();
    // A backslash is a separator for special schemes, so this normalizes to
    // `http://evil.example/x` despite opening with a single `/`.
    expect(
      parseRecorderAction({ kind: "navigate", path: "/\\evil.example/x" }),
    ).toBeNull();
    expect(
      parseRecorderAction({ kind: "navigate", path: "/\\\\evil.example/x" }),
    ).toBeNull();
    expect(
      parseRecorderAction({ kind: "navigate", path: "javascript:alert(1)" }),
    ).toBeNull();
    // Naming the sentinel base the validator resolves against doesn't help:
    // Playwright resolves this against the real preview, not that base.
    expect(
      parseRecorderAction({ kind: "navigate", path: "//dyad.invalid/x" }),
    ).toBeNull();
  });

  it("accepts a path whose backslash isn't leading", () => {
    // Resolution only turns `/\` at the front into an authority, so a backslash
    // deeper in the path is an ordinary character and stays on-origin.
    expect(
      parseRecorderAction({ kind: "navigate", path: "/docs/a\\b" }),
    ).toEqual({ kind: "navigate", path: "/docs/a\\b" });
  });

  it("rejects oversized payloads", () => {
    expect(
      parseRecorderAction({
        kind: "click",
        locator: { kind: "css", value: "x".repeat(5_000) },
      }),
    ).toBeNull();
    expect(
      parseRecorderAction({
        kind: "select",
        locator: { kind: "testid", value: "colors" },
        values: Array.from({ length: 500 }, () => "red"),
      }),
    ).toBeNull();
  });

  it("accepts a press with no locator (a page-level shortcut)", () => {
    expect(parseRecorderAction({ kind: "press", key: "Escape" })).toEqual({
      kind: "press",
      key: "Escape",
    });
  });
});
