// @vitest-environment node

import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isPrereleaseVersion,
  makeLatestForVersion,
  releasePayloadForVersion,
  selectPreviousDifferentVersionRun,
} = require("../../scripts/update-release-metadata.js");

describe("release metadata script", () => {
  it("detects prerelease versions from package.json version strings", () => {
    expect(isPrereleaseVersion("1.3.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("1.3.0")).toBe(false);
  });

  it("marks stable releases as latest and prereleases as not latest", () => {
    expect(makeLatestForVersion("1.3.0-beta.1")).toBe("false");
    expect(makeLatestForVersion("1.3.0")).toBe("true");
  });

  it("selects the latest successful release run with a different version", () => {
    expect(
      selectPreviousDifferentVersionRun({
        currentVersion: "1.3.0-beta.1",
        runsWithVersions: [
          {
            conclusion: "success",
            id: 3,
            version: "1.3.0-beta.1",
          },
          {
            conclusion: "failure",
            id: 2,
            version: "1.2.0",
          },
          {
            conclusion: "success",
            id: 1,
            version: "1.2.0",
          },
        ],
      }),
    ).toEqual({
      conclusion: "success",
      id: 1,
      version: "1.2.0",
    });
  });

  it("builds the release patch payload from generated GitHub notes", () => {
    expect(
      releasePayloadForVersion({
        generatedNotes: {
          body: "## What's Changed\n* Test",
          name: "v1.3.0",
        },
        version: "1.3.0",
      }),
    ).toEqual({
      body: "## What's Changed\n* Test",
      draft: true,
      make_latest: "true",
      name: "v1.3.0",
      prerelease: false,
    });
  });
});
