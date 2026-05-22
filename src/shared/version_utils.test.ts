import { describe, expect, it } from "vitest";
import { isVersionAtLeast } from "./version_utils";

describe("isVersionAtLeast", () => {
  it("compares major, minor, and patch versions", () => {
    expect(isVersionAtLeast("10.16.0", "10.16.0")).toBe(true);
    expect(isVersionAtLeast("10.16.1", "10.16.0")).toBe(true);
    expect(isVersionAtLeast("10.15.9", "10.16.0")).toBe(false);
    expect(isVersionAtLeast("9.99.99", "10.16.0")).toBe(false);
  });

  it("accepts node-style v prefixes", () => {
    expect(isVersionAtLeast("v22.13.0", "22.13.0")).toBe(true);
    expect(isVersionAtLeast("v22.12.0", "22.13.0")).toBe(false);
  });

  it("treats prereleases as lower than their final release", () => {
    expect(isVersionAtLeast("22.13.0-rc.1", "22.13.0")).toBe(false);
    expect(isVersionAtLeast("v22.13.0-rc.1", "22.13.0")).toBe(false);
    expect(isVersionAtLeast("22.13.0", "22.13.0-rc.1")).toBe(true);
  });

  it("returns false for unparsable versions", () => {
    expect(isVersionAtLeast("not-a-version", "22.13.0")).toBe(false);
    expect(isVersionAtLeast("22.13.0", "not-a-version")).toBe(false);
  });
});
