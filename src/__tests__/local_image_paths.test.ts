import { describe, expect, it } from "vitest";
import {
  extractLocalImagePaths,
  stripLocalImagePaths,
} from "@/lib/local_image_paths";

describe("extractLocalImagePaths", () => {
  it("finds an absolute image path in a sentence", () => {
    expect(
      extractLocalImagePaths(
        "I saved it to /Users/ace/Vault/Media/Images/dashboard.png for you.",
      ),
    ).toEqual(["/Users/ace/Vault/Media/Images/dashboard.png"]);
  });

  it("handles a file:// URL", () => {
    expect(extractLocalImagePaths("file:///tmp/render.webp is ready")).toEqual([
      "/tmp/render.webp",
    ]);
  });

  it("drops sentence punctuation but keeps the extension", () => {
    expect(extractLocalImagePaths("Done: /tmp/a.png.")).toEqual(["/tmp/a.png"]);
    expect(extractLocalImagePaths("See (/tmp/b.jpg)")).toEqual(["/tmp/b.jpg"]);
  });

  it("returns each path once", () => {
    expect(extractLocalImagePaths("/tmp/x.png and again /tmp/x.png")).toEqual([
      "/tmp/x.png",
    ]);
  });

  it("ignores a path already used as a markdown image", () => {
    expect(extractLocalImagePaths("![render](/tmp/render.png)")).toEqual([]);
  });

  it("ignores bare filenames in prose", () => {
    expect(extractLocalImagePaths("Open diagram.png in your editor")).toEqual(
      [],
    );
  });

  it("ignores non-image files", () => {
    expect(extractLocalImagePaths("Wrote /tmp/report.pdf")).toEqual([]);
  });

  it("finds several images at once", () => {
    expect(
      extractLocalImagePaths("/tmp/one.png\n/tmp/two.jpeg\n/tmp/three.svg"),
    ).toEqual(["/tmp/one.png", "/tmp/two.jpeg", "/tmp/three.svg"]);
  });

  it("returns nothing for empty text", () => {
    expect(extractLocalImagePaths("")).toEqual([]);
  });
});

describe("stripLocalImagePaths", () => {
  it("removes a line that held only the path", () => {
    const text = "Here is your image:\n/tmp/render.png\nAnything else?";
    const stripped = stripLocalImagePaths(text, ["/tmp/render.png"]);
    expect(stripped).toBe("Here is your image:\nAnything else?");
  });

  it("removes a labelled path line entirely", () => {
    const text = "Generated.\nSaved to: /tmp/render.png\nEnjoy.";
    expect(stripLocalImagePaths(text, ["/tmp/render.png"])).toBe(
      "Generated.\nEnjoy.",
    );
  });

  it("keeps the surrounding sentence when the path is inline", () => {
    const stripped = stripLocalImagePaths("I saved it to /tmp/a.png for you.", [
      "/tmp/a.png",
    ]);
    expect(stripped).toContain("I saved it to");
    expect(stripped).toContain("for you.");
    expect(stripped).not.toContain("/tmp/a.png");
  });

  it("leaves text untouched when there are no paths", () => {
    expect(stripLocalImagePaths("Nothing here", [])).toBe("Nothing here");
  });

  it("collapses the blank space left behind", () => {
    const stripped = stripLocalImagePaths(
      "Done.\n\n/tmp/a.png\n\n\n/tmp/b.png\n\nBye.",
      ["/tmp/a.png", "/tmp/b.png"],
    );
    expect(stripped).toBe("Done.\n\nBye.");
  });
});
