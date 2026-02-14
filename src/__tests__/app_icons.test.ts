import { describe, expect, it } from "vitest";
import {
  createGeneratedIconDataForApp,
  deriveAvatarStyle,
  getFallbackLetter,
  parseGeneratedIconData,
} from "@/lib/appIcons";

describe("app icon utilities", () => {
  it("generates deterministic icon data for the same app input", () => {
    const first = createGeneratedIconDataForApp(12, "alpha");
    const second = createGeneratedIconDataForApp(12, "alpha");
    expect(first).toBe(second);
  });

  it("generates different icon data for copied apps", () => {
    const source = createGeneratedIconDataForApp(12, "alpha");
    const copy = createGeneratedIconDataForApp(99, "alpha-copy");
    expect(source).not.toBe(copy);
  });

  it("parses valid generated icon payload", () => {
    const payload = createGeneratedIconDataForApp(1, "demo");
    expect(parseGeneratedIconData("generated", payload)).not.toBeNull();
  });

  it("rejects malformed generated icon payload", () => {
    expect(parseGeneratedIconData("generated", '{"seed":1}')).toBeNull();
    expect(parseGeneratedIconData("generated", "{not-json")).toBeNull();
    expect(parseGeneratedIconData("emoji", "🙂")).toBeNull();
  });

  it("returns fallback letter for empty and non-empty app names", () => {
    expect(getFallbackLetter("dyad")).toBe("D");
    expect(getFallbackLetter("")).toBe("?");
  });

  it("derives deterministic avatar style by seed", () => {
    const first = deriveAvatarStyle("abc123");
    const second = deriveAvatarStyle("abc123");
    expect(first).toEqual(second);
  });
});
