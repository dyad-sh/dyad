import { describe, it, expect } from "vitest";
import {
  escapeXmlAttr,
  unescapeXmlAttr,
  escapeXmlContent,
  unescapeXmlContent,
} from "../../shared/xmlEscape";

describe("xmlEscape", () => {
  describe("escapeXmlAttr", () => {
    it("should escape ampersands", () => {
      expect(escapeXmlAttr("foo & bar")).toBe("foo &amp; bar");
    });

    it("should escape double quotes", () => {
      expect(escapeXmlAttr('foo "bar" baz')).toBe("foo &quot;bar&quot; baz");
    });

    it("should escape angle brackets", () => {
      expect(escapeXmlAttr("foo <bar> baz")).toBe("foo &lt;bar&gt; baz");
    });

    it("should escape all special characters together", () => {
      expect(escapeXmlAttr('use <a> and "b" & c')).toBe(
        "use &lt;a&gt; and &quot;b&quot; &amp; c",
      );
    });

    it("should handle empty strings", () => {
      expect(escapeXmlAttr("")).toBe("");
    });

    it("should not modify strings without special characters", () => {
      expect(escapeXmlAttr("hello world")).toBe("hello world");
    });
  });

  describe("unescapeXmlAttr", () => {
    it("should unescape ampersands", () => {
      expect(unescapeXmlAttr("foo &amp; bar")).toBe("foo & bar");
    });

    it("should unescape double quotes", () => {
      expect(unescapeXmlAttr("foo &quot;bar&quot; baz")).toBe('foo "bar" baz');
    });

    it("should unescape angle brackets", () => {
      expect(unescapeXmlAttr("foo &lt;bar&gt; baz")).toBe("foo <bar> baz");
    });

    it("should unescape all special characters together", () => {
      expect(unescapeXmlAttr("use &lt;a&gt; and &quot;b&quot; &amp; c")).toBe(
        'use <a> and "b" & c',
      );
    });

    it("should handle empty strings", () => {
      expect(unescapeXmlAttr("")).toBe("");
    });

    it("should not modify strings without escaped characters", () => {
      expect(unescapeXmlAttr("hello world")).toBe("hello world");
    });
  });

  describe("escapeXmlContent", () => {
    it("should escape ampersands", () => {
      expect(escapeXmlContent("foo & bar")).toBe("foo &amp; bar");
    });

    it("should escape angle brackets", () => {
      expect(escapeXmlContent("foo <bar> baz")).toBe("foo &lt;bar&gt; baz");
    });

    it("should NOT escape double quotes (content doesn't need it)", () => {
      expect(escapeXmlContent('foo "bar" baz')).toBe('foo "bar" baz');
    });

    it("should handle empty strings", () => {
      expect(escapeXmlContent("")).toBe("");
    });
  });

  describe("unescapeXmlContent", () => {
    it("should unescape ampersands", () => {
      expect(unescapeXmlContent("foo &amp; bar")).toBe("foo & bar");
    });

    it("should unescape angle brackets", () => {
      expect(unescapeXmlContent("foo &lt;bar&gt; baz")).toBe("foo <bar> baz");
    });

    it("should handle empty strings", () => {
      expect(unescapeXmlContent("")).toBe("");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip attribute values correctly", () => {
      const original = 'path with <special> "chars" & ampersand';
      const escaped = escapeXmlAttr(original);
      const unescaped = unescapeXmlAttr(escaped);
      expect(unescaped).toBe(original);
    });

    it("should roundtrip content correctly", () => {
      const original = "content with <tags> & ampersand";
      const escaped = escapeXmlContent(original);
      const unescaped = unescapeXmlContent(escaped);
      expect(unescaped).toBe(original);
    });

    it("should handle complex nested escapes correctly", () => {
      // Test that &amp;lt; doesn't get double-unescaped
      const original = "literal &lt; should stay as &lt;";
      const escaped = escapeXmlContent(original);
      expect(escaped).toBe("literal &amp;lt; should stay as &amp;lt;");
      const unescaped = unescapeXmlContent(escaped);
      expect(unescaped).toBe(original);
    });
  });
});
