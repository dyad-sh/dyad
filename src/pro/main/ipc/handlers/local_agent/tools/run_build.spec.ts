import { describe, expect, it } from "vitest";

import {
  runBuildTool,
  selectBuildExecutionMode,
  type BuildProjectFacts,
} from "./run_build";

const safeViteFacts: BuildProjectFacts = {
  frameworkType: "vite",
  buildScript: "vite build",
  hasPrebuildScript: false,
  hasPostbuildScript: false,
  defaultOutputIgnored: true,
  hasFrameworkConfig: false,
  nextMajorVersion: null,
  previewRunning: true,
  nextDevOutputIsolated: false,
};

describe("run_build", () => {
  it("requires consent for the exact package.json build lifecycle", () => {
    expect(runBuildTool.defaultConsent).toBe("ask");
    expect(runBuildTool.modifiesState).toBe(true);
    expect(
      runBuildTool.inputSchema.parse({
        expected_prebuild_script: null,
        expected_build_script: "vite build",
        expected_postbuild_script: "node scripts/publish.mjs",
      }),
    ).toEqual({
      expected_prebuild_script: null,
      expected_build_script: "vite build",
      expected_postbuild_script: "node scripts/publish.mjs",
    });
    expect(
      runBuildTool.getConsentPreview?.({
        expected_prebuild_script: null,
        expected_build_script: "vite build",
        expected_postbuild_script: "node scripts/publish.mjs",
      }),
    ).toBe(
      "prebuild: (none)\nbuild: vite build\npostbuild: node scripts/publish.mjs",
    );
  });

  it("builds only the narrow standard Vite case in place", () => {
    expect(selectBuildExecutionMode(safeViteFacts)).toBe("in-place");

    for (const unsafe of [
      { hasPrebuildScript: true },
      { hasPostbuildScript: true },
      { defaultOutputIgnored: false },
      { hasFrameworkConfig: true },
      { buildScript: "tsc -b && vite build" },
    ]) {
      expect(selectBuildExecutionMode({ ...safeViteFacts, ...unsafe })).toBe(
        "isolated",
      );
    }
  });

  it("requires Next 16 isolated dev output before building beside a preview", () => {
    const safeNextFacts: BuildProjectFacts = {
      ...safeViteFacts,
      frameworkType: "nextjs",
      buildScript: "next build",
      nextMajorVersion: 16,
      nextDevOutputIsolated: true,
    };

    expect(selectBuildExecutionMode(safeNextFacts)).toBe("in-place");
    expect(
      selectBuildExecutionMode({ ...safeNextFacts, nextMajorVersion: 15 }),
    ).toBe("isolated");
    expect(
      selectBuildExecutionMode({
        ...safeNextFacts,
        nextDevOutputIsolated: false,
      }),
    ).toBe("isolated");
    expect(
      selectBuildExecutionMode({
        ...safeNextFacts,
        previewRunning: false,
        nextDevOutputIsolated: false,
      }),
    ).toBe("in-place");
  });

  it("isolates unknown frameworks", () => {
    expect(
      selectBuildExecutionMode({
        ...safeViteFacts,
        frameworkType: null,
      }),
    ).toBe("isolated");
  });
});
