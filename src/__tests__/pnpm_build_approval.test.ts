import { describe, expect, it } from "vitest";

import { applyBuildApprovals } from "@/ipc/utils/pnpm_build_approval";

/** Exactly what pnpm 11 writes after an install with unapproved builds. */
const PNPM_PLACEHOLDER = `allowBuilds:
  '@swc/core': set this to true or false
  esbuild: set this to true or false
`;

describe("applyBuildApprovals", () => {
  it("fills in the placeholder pnpm leaves behind", () => {
    const { contents, skipped } = applyBuildApprovals(PNPM_PLACEHOLDER);
    expect(contents).toContain('"@swc/core": true');
    expect(contents).toContain("esbuild: true");
    expect(contents).not.toContain("set this to true or false");
    expect(skipped).toEqual([]);
  });

  it("leaves an already-approved file alone", () => {
    const approved = 'allowBuilds:\n  "@swc/core": true\n  esbuild: true\n';
    expect(applyBuildApprovals(approved).contents).toBeNull();
  });

  it("respects a deliberate false", () => {
    const denied = "allowBuilds:\n  esbuild: false\n";
    expect(applyBuildApprovals(denied).contents).toBeNull();
  });

  it("does not approve a package outside the allowlist", () => {
    const unknown =
      "allowBuilds:\n  sketchy-postinstall: set this to true or false\n";
    const { contents, skipped } = applyBuildApprovals(unknown);
    expect(contents).toBeNull();
    expect(skipped).toEqual(["sketchy-postinstall"]);
  });

  it("approves the known ones and reports the rest", () => {
    const mixed = `allowBuilds:
  esbuild: set this to true or false
  something-else: set this to true or false
`;
    const { contents, skipped } = applyBuildApprovals(mixed);
    expect(contents).toContain("esbuild: true");
    expect(contents).toContain("something-else: set this to true or false");
    expect(skipped).toEqual(["something-else"]);
  });

  it("writes a fresh block for an empty file", () => {
    const { contents } = applyBuildApprovals("");
    expect(contents).toContain("allowBuilds:");
    expect(contents).toContain("esbuild: true");
  });

  it("keeps other workspace settings intact", () => {
    const withPackages = `packages:
  - "apps/*"

allowBuilds:
  esbuild: set this to true or false
`;
    const { contents } = applyBuildApprovals(withPackages);
    expect(contents).toContain('packages:\n  - "apps/*"');
    expect(contents).toContain("esbuild: true");
  });

  it("appends the block when the file has no allowBuilds", () => {
    const { contents } = applyBuildApprovals('packages:\n  - "apps/*"\n');
    expect(contents).toContain('packages:\n  - "apps/*"');
    expect(contents).toContain("allowBuilds:");
  });

  it("stops at the end of the block", () => {
    const trailing = `allowBuilds:
  esbuild: set this to true or false
someOtherSetting: value
`;
    const { contents } = applyBuildApprovals(trailing);
    expect(contents).toContain("esbuild: true");
    expect(contents).toContain("someOtherSetting: value");
  });

  it("handles quoted and unquoted keys the same", () => {
    const quoted = `allowBuilds:
  "esbuild": set this to true or false
  '@swc/core': set this to true or false
`;
    const { contents } = applyBuildApprovals(quoted);
    expect(contents).toContain("esbuild: true");
    expect(contents).toContain('"@swc/core": true');
  });

  it("treats an empty value as needing approval", () => {
    const empty = "allowBuilds:\n  esbuild:\n";
    expect(applyBuildApprovals(empty).contents).toContain("esbuild: true");
  });

  it("honours a caller-supplied allowlist", () => {
    const { contents, skipped } = applyBuildApprovals(
      "allowBuilds:\n  only-this: set this to true or false\n",
      ["only-this"],
    );
    expect(contents).toContain("only-this: true");
    expect(skipped).toEqual([]);
  });
});
