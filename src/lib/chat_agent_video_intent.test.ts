import { describe, expect, it } from "vitest";
import { detectVideoPrompt } from "./chat_agent_video_intent";

describe("detectVideoPrompt", () => {
  it("detects natural-language video requests", () => {
    expect(detectVideoPrompt("create a video of a spaceship landing")).toEqual({
      prompt: "create a video of a spaceship landing",
      format: "youtube_shorts",
    });
    expect(detectVideoPrompt("make an Instagram reel for my cafe")).toEqual({
      prompt: "make an Instagram reel for my cafe",
      format: "instagram_reels",
    });
  });

  it("supports explicit video commands", () => {
    expect(detectVideoPrompt("/video a cinematic neon city")).toEqual({
      prompt: "a cinematic neon city",
      format: "youtube_shorts",
    });
  });

  it("recognises common video typos without rewriting the prompt", () => {
    expect(detectVideoPrompt("create a vedio of a spaceship landing")).toEqual({
      prompt: "create a vedio of a spaceship landing",
      format: "youtube_shorts",
    });
    expect(detectVideoPrompt("make an animtion of this image")).toEqual({
      prompt: "make an animtion of this image",
      format: "youtube_shorts",
    });
  });

  it("does not intercept questions about video", () => {
    expect(detectVideoPrompt("how does video compression work?")).toBeNull();
    expect(detectVideoPrompt("write a video player component")).toBeNull();
  });
});
