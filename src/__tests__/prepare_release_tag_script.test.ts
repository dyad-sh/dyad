// @vitest-environment node

import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertReleaseCanMoveTag,
  getRepoParts,
} = require("../../scripts/prepare-release-tag.js");

describe("prepare release tag script", () => {
  it("allows missing or draft releases to move a tag", () => {
    expect(() =>
      assertReleaseCanMoveTag({ release: null, tagName: "v1.3.0" }),
    ).not.toThrow();
    expect(() =>
      assertReleaseCanMoveTag({
        release: { draft: true },
        tagName: "v1.3.0",
      }),
    ).not.toThrow();
  });

  it("refuses to move a tag for a published release", () => {
    expect(() =>
      assertReleaseCanMoveTag({
        release: { draft: false },
        tagName: "v1.3.0",
      }),
    ).toThrow("Release v1.3.0 is already published");
  });

  it("parses GitHub repository coordinates", () => {
    expect(getRepoParts("dyad-sh/dyad")).toEqual({
      owner: "dyad-sh",
      repo: "dyad",
    });
  });
});
