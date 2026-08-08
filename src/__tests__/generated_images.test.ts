import { describe, expect, it } from "vitest";

import { selectGeneratedImages } from "@/ipc/utils/generated_images";

const A = "data:image/png;base64,AAAA";
const B = "data:image/png;base64,BBBB";

describe("selectGeneratedImages", () => {
  it("keeps a single image", () => {
    expect(selectGeneratedImages([A])).toEqual([A]);
  });

  it("keeps only the first when a model returns several variants", () => {
    // Gemini 3 Pro Image answers one prompt with near-identical variants;
    // showing them all reads as the chat repeating itself.
    expect(selectGeneratedImages([A, B])).toEqual([A]);
  });

  it("drops exact duplicates before choosing", () => {
    expect(selectGeneratedImages([A, A])).toEqual([A]);
  });

  it("ignores anything that is not image data", () => {
    expect(selectGeneratedImages(["https://example.com/x.png", A])).toEqual([
      A,
    ]);
  });

  it("returns nothing when there is no usable image", () => {
    expect(selectGeneratedImages([])).toEqual([]);
    expect(selectGeneratedImages(["not-an-image"])).toEqual([]);
  });
});
