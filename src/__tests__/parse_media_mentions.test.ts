import { describe, expect, it } from "vitest";
import {
  parseMediaMentions,
  stripResolvedMediaMentions,
} from "../shared/parse_media_mentions";

describe("parseMediaMentions", () => {
  it("parses @media mentions from prompt text", () => {
    const prompt = "Check @media:cat.png and @media:dog.png please";

    expect(parseMediaMentions(prompt)).toEqual(["cat.png", "dog.png"]);
  });

  it("ignores trailing punctuation after mention", () => {
    const prompt = "Look at @media:cat.png, please";

    expect(parseMediaMentions(prompt)).toEqual(["cat.png"]);
  });

  it("parses @media mentions with URL-encoded filenames (e.g. spaces)", () => {
    const prompt = "Check @media:my%20photo.png please";

    expect(parseMediaMentions(prompt)).toEqual(["my%20photo.png"]);
  });
});

describe("stripResolvedMediaMentions", () => {
  it("keeps user text when media mention is followed by adjacent text", () => {
    const prompt = "@media:cat.pngdescribe this image";

    expect(stripResolvedMediaMentions(prompt, ["cat.png"])).toBe(
      "describe this image",
    );
  });

  it("strips only resolved mentions and preserves unresolved ones", () => {
    const prompt = "Use @media:cat.png and @media:missing.png now";

    expect(stripResolvedMediaMentions(prompt, ["cat.png"])).toBe(
      "Use and @media:missing.png now",
    );
  });

  it("strips URL-encoded mentions (filenames with spaces)", () => {
    const prompt = "Check @media:my%20photo.png please";

    expect(stripResolvedMediaMentions(prompt, ["my%20photo.png"])).toBe(
      "Check please",
    );
  });
});
