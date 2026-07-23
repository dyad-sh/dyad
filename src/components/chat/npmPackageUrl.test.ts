import { describe, expect, it } from "vitest";
import { getNpmPackagePageUrl } from "./npmPackageUrl";

describe("getNpmPackagePageUrl", () => {
  it.each([
    ["react", "https://www.npmjs.com/package/react"],
    ["react@latest", "https://www.npmjs.com/package/react"],
    ["react@18.3.1", "https://www.npmjs.com/package/react"],
    ["@scope/pkg", "https://www.npmjs.com/package/@scope/pkg"],
    ["@scope/pkg@^2", "https://www.npmjs.com/package/@scope/pkg"],
  ])("links %s to its canonical package page", (spec, expected) => {
    expect(getNpmPackagePageUrl(spec)).toBe(expected);
  });
});
