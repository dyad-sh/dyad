import { describe, expect, it } from "vitest";

import { particleCanvasHeight } from "./ParticleBackground";

describe("particleCanvasHeight", () => {
  it("covers the complete scrollable page instead of stopping at the viewport", () => {
    expect(
      particleCanvasHeight({
        visibleHeight: 720,
        clientHeight: 720,
        scrollHeight: 1480,
      }),
    ).toBe(1480);
  });

  it("still fills a viewport when content is short", () => {
    expect(
      particleCanvasHeight({
        visibleHeight: 720,
        clientHeight: 720,
        scrollHeight: 540,
      }),
    ).toBe(720);
  });
});
