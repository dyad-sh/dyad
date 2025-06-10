import { describe, it, expect } from "vitest";
import { cleanResponse } from "./clean_response_utils";

describe("cleanResponse", () => {
  describe("cleanThinkingByEscapingDyadTags", () => {
    it("should not change string with no think tags", () => {
      const input = "Some regular text without think tags.";
      expect(cleanResponse(input)).toBe(input);
    });

    it("should not change string with think tags but no dyad tags", () => {
      const input = "<think>Some thinking here.</think>";
      expect(cleanResponse(input)).toBe(input);
    });

    it("should escape dyad tags within think tags", () => {
      const input =
        "<think>I am thinking about <dyad-write path='test'> and </dyad-write> tags.</think>";
      const expected =
        "<think>I am thinking about ＜dyad-write path='test'> and ＜/dyad-write> tags.</think>";
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should handle multiple think blocks", () => {
      const input =
        "<think>one <dyad-tag></dyad-tag></think> and <think>two <dyad-tag></dyad-tag></think>";
      const expected =
        "<think>one ＜dyad-tag>＜/dyad-tag></think> and <think>two ＜dyad-tag>＜/dyad-tag></think>";
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should handle nested-like dyad tags", () => {
      const input =
        "<think><dyad-outer><dyad-inner></dyad-inner></dyad-outer></think>";
      const expected =
        "<think>＜dyad-outer>＜dyad-inner>＜/dyad-inner>＜/dyad-outer></think>";
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should not replace uppercase <Dyad..> tags but will replace lowercase </dyad...>", () => {
      const input = "<think><Dyad-tag> and </dyad-tag></think>";
      const expected = "<think><Dyad-tag> and ＜/dyad-tag></think>";
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should replace lowercase <dyad..> tags but not uppercase </Dyad...>", () => {
      const input = "<think><dyad-tag> and </Dyad-tag></think>";
      const expected = "<think>＜dyad-tag> and </Dyad-tag></think>";
      expect(cleanResponse(input)).toBe(expected);
    });
  });

  describe("cleanDyadPaths", () => {
    it("should lowercase the path in a dyad-write tag with content", () => {
      const input = `<dyad-write path="fooBar/bar.ts" description="changes">
some contents...
</dyad-write>`;
      const expected = `<dyad-write path="foobar/bar.ts" description="changes">
some contents...
</dyad-write>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should lowercase the path in a dyad-write tag with single quotes", () => {
      const input = `<dyad-write path='fooBar/bar.ts' description="changes"></dyad-write>`;
      const expected = `<dyad-write path='foobar/bar.ts' description="changes"></dyad-write>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should not change a dyad-write tag without a path attribute", () => {
      const input = `<dyad-write description="changes"></dyad-write>`;
      expect(cleanResponse(input)).toBe(input);
    });

    it("should only lowercase path for dyad-write tags and not other dyad tags", () => {
      const input = `<dyad-write path="A/B"></dyad-write> and <dyad-read path="C/D"></dyad-read>`;
      const expected = `<dyad-write path="a/B"></dyad-write> and <dyad-read path="C/D"></dyad-read>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should not lowercase path for non-dyad-write tags like dyad-path", () => {
      const input = `<dyad-path path="Foo/Bar"></dyad-path>`;
      expect(cleanResponse(input)).toBe(input);
    });

    it("should handle mixed case paths for dyad-write, preserving filename case", () => {
      const input = `<dyad-write path="src/APIs/UserAPI.js"></dyad-write>`;
      const expected = `<dyad-write path="src/apis/UserAPI.js"></dyad-write>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should handle windows-style paths for dyad-write, preserving filename case", () => {
      const input = `<dyad-write path="C:\\Users\\Test\\File.txt"></dyad-write>`;
      const expected = `<dyad-write path="c:\\users\\test\\File.txt"></dyad-write>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should not change a dyad-write tag if path has no value", () => {
      const input = `<dyad-write path=""></dyad-write>`;
      expect(cleanResponse(input)).toBe(input);
    });

    it("should lowercase a full directory path", () => {
      const input = `<dyad-write path="src/APIs/"></dyad-write>`;
      const expected = `<dyad-write path="src/apis/"></dyad-write>`;
      expect(cleanResponse(input)).toBe(expected);
    });

    it("should preserve case for a path that is only a filename", () => {
      const input = `<dyad-write path="MyComponent.tsx"></dyad-write>`;
      expect(cleanResponse(input)).toBe(input);
    });
  });
});
