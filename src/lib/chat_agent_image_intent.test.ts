import { describe, expect, it } from "vitest";
import { detectImagePrompt } from "./chat_agent_image_intent";

describe("detectImagePrompt", () => {
  it("detects natural-language image requests", () => {
    expect(detectImagePrompt("generate an image of a sunset")).toBe(
      "generate an image of a sunset",
    );
    expect(detectImagePrompt("create a logo for my coffee shop")).toBe(
      "create a logo for my coffee shop",
    );
    expect(detectImagePrompt("draw a picture of a robot")).toBe(
      "draw a picture of a robot",
    );
    expect(detectImagePrompt("make a banner for the sale")).toBe(
      "make a banner for the sale",
    );
  });

  it("strips command prefixes", () => {
    expect(detectImagePrompt("/image a neon city at night")).toBe(
      "a neon city at night",
    );
    expect(detectImagePrompt("/img red sports car")).toBe("red sports car");
  });

  it("recognises common image typos without rewriting the prompt", () => {
    expect(detectImagePrompt("create an iage of hulk hogan")).toBe(
      "create an iage of hulk hogan",
    );
    expect(detectImagePrompt("generate a iamge of a sunset")).toBe(
      "generate a iamge of a sunset",
    );
    expect(detectImagePrompt("make a picure of my dog")).toBe(
      "make a picure of my dog",
    );
  });

  it("ignores non-image messages", () => {
    expect(detectImagePrompt("what's the weather today?")).toBeNull();
    expect(detectImagePrompt("summarize this article")).toBeNull();
    expect(detectImagePrompt("write a function to draw a chart")).toBeNull();
    expect(detectImagePrompt("")).toBeNull();
  });
});
