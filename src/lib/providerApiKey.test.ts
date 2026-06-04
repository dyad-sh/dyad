import { describe, expect, it } from "vitest";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";

describe("providerApiKey", () => {
  it("trims pasted API keys", () => {
    expect(normalizeProviderApiKeyInput("  sk-test\n")).toBe("sk-test");
  });

  it("accepts printable ASCII key characters", () => {
    expect(
      findInvalidProviderApiKeyCharacter("sk-test_123.ABC/+=:"),
    ).toBeNull();
  });

  it("finds non-ASCII characters that cannot be used in Authorization headers", () => {
    expect(findInvalidProviderApiKeyCharacter("sk-test—copied")).toEqual({
      index: 7,
      codePoint: 0x2014,
    });
  });

  it("finds embedded whitespace", () => {
    expect(findInvalidProviderApiKeyCharacter("sk-test copied")).toEqual({
      index: 7,
      codePoint: 0x20,
    });
  });

  it("formats an actionable validation message", () => {
    expect(
      formatInvalidProviderApiKeyMessage("OpenAI", {
        index: 7,
        codePoint: 0x2014,
      }),
    ).toContain("OpenAI API key contains an invalid character at index 7");
  });
});
