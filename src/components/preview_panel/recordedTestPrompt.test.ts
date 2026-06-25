import { describe, it, expect } from "vitest";
import { buildRecordedTestPrompt } from "./recordedTestPrompt";
import type { RecordedAction } from "@/ipc/types/tests";

function action(partial: Partial<RecordedAction>): RecordedAction {
  return { kind: "click", timestamp: 0, ...partial } as RecordedAction;
}

describe("buildRecordedTestPrompt", () => {
  it("numbers the steps in order", () => {
    const prompt = buildRecordedTestPrompt([
      action({ kind: "click", selector: { role: "button", name: "Sign up" } }),
      action({
        kind: "fill",
        selector: { role: "textbox", label: "Email" },
        value: "a@b.com",
      }),
    ]);
    expect(prompt).toContain("1. Click the button \"Sign up\".");
    expect(prompt).toContain('2. Fill the field labeled "Email" with "a@b.com".');
  });

  it("describes each action kind", () => {
    const prompt = buildRecordedTestPrompt([
      action({ kind: "select", selector: { name: "Country" }, value: "US" }),
      action({ kind: "check", selector: { name: "Agree" }, value: "true" }),
      action({ kind: "check", selector: { name: "News" }, value: "false" }),
      action({ kind: "press", selector: { placeholder: "Search" }, value: "Enter" }),
      action({ kind: "navigate", url: "/dashboard" }),
    ]);
    expect(prompt).toContain('Select "US" in "Country".');
    expect(prompt).toContain('Check "Agree".');
    expect(prompt).toContain('Uncheck "News".');
    expect(prompt).toContain('Press "Enter" in the field with placeholder "Search".');
    expect(prompt).toContain("Navigate to /dashboard.");
  });

  it("includes locator hints as JSON", () => {
    const prompt = buildRecordedTestPrompt([
      action({
        kind: "click",
        selector: { role: "button", name: "Save", testId: "save-btn" },
      }),
    ]);
    expect(prompt).toContain('"role":"button"');
    expect(prompt).toContain('"testId":"save-btn"');
  });

  it("instructs the AI that the recording is actions-only and it must add assertions", () => {
    const prompt = buildRecordedTestPrompt([action({})]);
    expect(prompt.toLowerCase()).toContain("assert");
    expect(prompt).toContain("tests/");
  });
});
