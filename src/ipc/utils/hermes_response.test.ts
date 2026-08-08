import { describe, expect, it } from "vitest";

import { parseHermesResponseContent } from "./hermes_response";

describe("parseHermesResponseContent", () => {
  it("keeps normal text responses", () => {
    expect(parseHermesResponseContent("Hello")).toEqual({
      text: "Hello",
      images: [],
    });
  });

  it("extracts text and image URL content parts", () => {
    expect(
      parseHermesResponseContent([
        { type: "text", text: "Created with Hermes" },
        {
          type: "image_url",
          image_url: { url: "https://example.com/image.png" },
        },
      ]),
    ).toEqual({
      text: "Created with Hermes",
      images: ["https://example.com/image.png"],
    });
  });

  it("extracts base64 images returned in a separate images array", () => {
    expect(
      parseHermesResponseContent("", [{ type: "image", b64_json: "aGVybWVz" }]),
    ).toEqual({
      text: "",
      images: ["data:image/png;base64,aGVybWVz"],
    });
  });

  it("extracts Markdown images returned by an agent tool", () => {
    expect(
      parseHermesResponseContent(
        "Created by Hermes:\n\n![result](https://example.com/result.webp)",
      ),
    ).toEqual({
      text: "Created by Hermes:",
      images: ["https://example.com/result.webp"],
    });
  });
});
