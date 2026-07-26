import { describe, expect, it } from "vitest";
import { resolveDesignImageUrl } from "./designImages";

const APP_PATH = "/Users/me/dyad-apps/my-app";

describe("resolveDesignImageUrl", () => {
  it("resolves a path returned by generate_image", () => {
    expect(
      resolveDesignImageUrl(APP_PATH, ".dyad/media/generated-123-abc.png"),
    ).toBe(
      `dyad-media://media/${encodeURIComponent(APP_PATH)}/.dyad/media/generated-123-abc.png`,
    );
  });

  it("accepts a bare filename", () => {
    expect(resolveDesignImageUrl(APP_PATH, "generated-123-abc.png")).toBe(
      `dyad-media://media/${encodeURIComponent(APP_PATH)}/.dyad/media/generated-123-abc.png`,
    );
  });

  it("accepts Windows separators", () => {
    expect(
      resolveDesignImageUrl(APP_PATH, ".dyad\\media\\generated-123-abc.png"),
    ).toBe(
      `dyad-media://media/${encodeURIComponent(APP_PATH)}/.dyad/media/generated-123-abc.png`,
    );
  });

  it("rejects paths outside .dyad/media", () => {
    expect(resolveDesignImageUrl(APP_PATH, "src/secrets.png")).toBeNull();
    expect(resolveDesignImageUrl(APP_PATH, "/etc/passwd")).toBeNull();
    expect(resolveDesignImageUrl(APP_PATH, ".dyad/designs/1.json")).toBeNull();
  });

  it("rejects traversal attempts", () => {
    expect(
      resolveDesignImageUrl(APP_PATH, ".dyad/media/../../../etc/passwd"),
    ).toBeNull();
    expect(resolveDesignImageUrl(APP_PATH, ".dyad/media/..")).toBeNull();
    // A traversal segment cannot survive: the URL is rebuilt from the
    // basename, which here is a legitimate filename in the media dir.
    expect(resolveDesignImageUrl(APP_PATH, ".dyad/media/../media/a.png")).toBe(
      null,
    );
  });

  it("returns null without an app path or image path", () => {
    expect(resolveDesignImageUrl("", ".dyad/media/a.png")).toBeNull();
    expect(resolveDesignImageUrl(APP_PATH, "")).toBeNull();
  });
});
