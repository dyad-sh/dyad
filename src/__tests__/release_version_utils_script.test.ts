// @vitest-environment node

import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isPrereleaseVersion,
} = require("../../scripts/release-version-utils.js");

describe("release version utils script", () => {
  it("detects prerelease package versions", () => {
    expect(isPrereleaseVersion("1.3.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("1.3.0-rc.1")).toBe(true);
    expect(isPrereleaseVersion("1.3.0")).toBe(false);
  });
});
