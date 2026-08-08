import { describe, expect, it } from "vitest";

import {
  applyThinkingMode,
  isThinkingDisabled,
  NO_THINK_MARKER,
} from "@/lib/thinking_mode";

const settingsWith = (providerId: string, disableThinking: boolean) =>
  ({ providerSettings: { [providerId]: { disableThinking } } }) as never;

describe("isThinkingDisabled", () => {
  it("is off until the user turns it on", () => {
    expect(isThinkingDisabled(null, "mx_serve")).toBe(false);
    expect(
      isThinkingDisabled(settingsWith("mx_serve", false), "mx_serve"),
    ).toBe(false);
  });

  it("is on once set for a local provider", () => {
    expect(isThinkingDisabled(settingsWith("mx_serve", true), "mx_serve")).toBe(
      true,
    );
    expect(isThinkingDisabled(settingsWith("ollama", true), "ollama")).toBe(
      true,
    );
  });

  it("never applies to a cloud provider", () => {
    // A stray marker on a paid request wastes tokens and confuses the model.
    expect(isThinkingDisabled(settingsWith("openai", true), "openai")).toBe(
      false,
    );
  });
});

describe("applyThinkingMode", () => {
  it("leaves the message alone when thinking is on", () => {
    expect(applyThinkingMode("hi", false)).toBe("hi");
  });

  it("appends the marker when thinking is off", () => {
    expect(applyThinkingMode("hi", true)).toBe(`hi ${NO_THINK_MARKER}`);
  });

  it("does not append it twice", () => {
    const once = applyThinkingMode("hi", true);
    expect(applyThinkingMode(once, true)).toBe(once);
  });

  it("puts it at the end, clear of any code block", () => {
    const message = "fix this:\n\n```js\nconst a = 1;\n```";
    const result = applyThinkingMode(message, true);
    expect(result.endsWith(NO_THINK_MARKER)).toBe(true);
    expect(result).toContain("```js");
  });

  it("leaves an empty message untouched", () => {
    expect(applyThinkingMode("   ", true)).toBe("   ");
  });
});
