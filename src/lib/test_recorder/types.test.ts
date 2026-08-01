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
    expect(
      parseRecorderAction({ kind: "navigate", path: "javascript:alert(1)" }),
    ).toBeNull();
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
