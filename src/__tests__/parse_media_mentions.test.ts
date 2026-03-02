import { describe, expect, it } from "vitest";
import {
  parseMediaMentions,
  stripResolvedMediaMentions,
} from "../shared/parse_media_mentions";

describe("parseMediaMentions", () => {
  it("parses @media mentions from prompt text", () => {
    const prompt =
      "Check @media:demo-app/cat.png and @media:demo-app/dog.png please";

    expect(parseMediaMentions(prompt)).toEqual([
      "demo-app/cat.png",
      "demo-app/dog.png",
    ]);
  });
});

describe("stripResolvedMediaMentions", () => {
  it("keeps user text when media mention is followed by adjacent text", () => {
    const prompt = "@media:demo-app/cat.pngdescribe this image";

    expect(stripResolvedMediaMentions(prompt, ["demo-app/cat.png"])).toBe(
      "describe this image",
    );
  });

  it("strips only resolved mentions and preserves unresolved ones", () => {
    const prompt =
      "Use @media:demo-app/cat.png and @media:demo-app/missing.png now";

    expect(stripResolvedMediaMentions(prompt, ["demo-app/cat.png"])).toBe(
      "Use  and @media:demo-app/missing.png now",
    );
  });
});
