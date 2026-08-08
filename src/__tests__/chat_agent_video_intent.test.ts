import { describe, expect, it } from "vitest";

import { detectVideoPrompt } from "@/lib/chat_agent_video_intent";

const fires = (text: string) => detectVideoPrompt(text) !== null;

describe("detectVideoPrompt — requests that must reach fal", () => {
  it("takes the explicit command", () => {
    const intent = detectVideoPrompt("/video a rocket launching at dawn");
    expect(intent?.prompt).toBe("a rocket launching at dawn");
  });

  it("takes /animate", () => {
    expect(fires("/animate the attached photo")).toBe(true);
  });

  it("takes a plain verb-and-noun request", () => {
    expect(fires("make a video of a cat surfing")).toBe(true);
    expect(fires("generate a short clip of rain on glass")).toBe(true);
  });

  it("takes an instruction to animate something", () => {
    // Previously dropped: "animate" is a verb but carries no video noun.
    expect(fires("animate this image")).toBe(true);
    expect(fires("animate this photo of a wolf")).toBe(true);
    expect(fires("can you animate it for me")).toBe(true);
  });

  it("takes a bare noun phrase naming what is wanted", () => {
    // Previously dropped: no verb anywhere in the sentence.
    expect(fires("a 10 second video of a neon city")).toBe(true);
    expect(fires("a cinematic clip of waves at sunset")).toBe(true);
    expect(fires("another reel of the same character")).toBe(true);
  });

  it("takes a request phrased as a question", () => {
    expect(fires("can you make a video of a dragon?")).toBe(true);
    expect(fires("how about a 15 second clip of the logo spinning")).toBe(true);
  });
});

describe("detectVideoPrompt — things that must not cost money", () => {
  it("ignores an empty message", () => {
    expect(fires("")).toBe(false);
    expect(fires("   ")).toBe(false);
  });

  it("ignores a question about video as a subject", () => {
    expect(fires("what video formats do you support?")).toBe(false);
    expect(fires("explain how video compression works")).toBe(false);
    expect(fires("which animation style looks best?")).toBe(false);
  });

  it("ignores talk about a video that already exists", () => {
    expect(fires("I watched a video about this yesterday")).toBe(false);
    expect(fires("I uploaded the clip to the drive")).toBe(false);
  });

  it("ignores ordinary chat that merely contains the words", () => {
    expect(fires("the animation industry is competitive")).toBe(false);
    expect(fires("short answers are fine")).toBe(false);
  });

  it("still fires when a real request contains a past-tense word", () => {
    // "watched" must not veto an unmistakable request.
    expect(fires("I watched a clip like this — make a video of it")).toBe(true);
  });
});

describe("detectVideoPrompt — format", () => {
  it("chooses reels when the user names them", () => {
    expect(detectVideoPrompt("make an instagram reel of a puppy")?.format).toBe(
      "instagram_reels",
    );
  });

  it("defaults to the vertical short format", () => {
    expect(detectVideoPrompt("make a video of a puppy")?.format).toBe(
      "youtube_shorts",
    );
  });

  it("keeps the whole message as the prompt when there is no command", () => {
    // The description carries the detail fal needs; trimming it loses intent.
    expect(detectVideoPrompt("make a video of a red fox in snow")?.prompt).toBe(
      "make a video of a red fox in snow",
    );
  });
});

describe("detectVideoPrompt — requested length", () => {
  it("reads the length the user asked for", () => {
    expect(
      detectVideoPrompt("make a 30 second video of a fox")?.durationSeconds,
    ).toBe(30);
    expect(detectVideoPrompt("a 15s clip of rain")?.durationSeconds).toBe(15);
    expect(
      detectVideoPrompt("/video 20-second shot of a city")?.durationSeconds,
    ).toBe(20);
  });

  it("reports nothing when no length is named", () => {
    // The generator then falls back to its ten-second minimum.
    expect(
      detectVideoPrompt("make a video of a fox")?.durationSeconds,
    ).toBeUndefined();
  });

  it("ignores a nonsensical length", () => {
    expect(
      detectVideoPrompt("make a 0 second video of a fox")?.durationSeconds,
    ).toBeUndefined();
    expect(
      detectVideoPrompt("make a 999 second video of a fox")?.durationSeconds,
    ).toBeUndefined();
  });
});
