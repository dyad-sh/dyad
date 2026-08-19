import { describe, expect, it, vi } from "vitest";

import type { AgentContext } from "./types";

vi.mock("@/ipc/services/app_operation_coordinator", () => ({
  appOperationCoordinator: {
    run: vi.fn(async (_options: unknown, operation: () => Promise<unknown>) =>
      operation(),
    ),
  },
  readAppResource: vi.fn((resource: string) => ({ resource, mode: "read" })),
}));

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

  it("completes the status when the per-turn limit refuses a build", async () => {
    const onXmlComplete = vi.fn();
    const ctx = {
      appId: 42,
      appPath: "/unused",
      buildAttemptState: { count: 3 },
      onXmlComplete,
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      runBuildTool.execute(
        {
          expected_prebuild_script: null,
          expected_build_script: "vite build",
          expected_postbuild_script: null,
        },
        ctx,
      ),
    ).resolves.toContain("3-build limit");

    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('title="Build limit reached" state="warning"'),
    );
  });

  it("completes the status when an unchanged workspace refuses a retry", async () => {
    const onXmlComplete = vi.fn();
    const ctx = {
      appId: 43,
      appPath: "/unused",
      mutationCount: 7,
      buildAttemptState: { count: 1, mutationCountAtLastRun: 7 },
      onXmlComplete,
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      runBuildTool.execute(
        {
          expected_prebuild_script: null,
          expected_build_script: "vite build",
          expected_postbuild_script: null,
        },
        ctx,
      ),
    ).resolves.toContain("workspace has not changed");

    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('title="Build not repeated" state="warning"'),
    );
  });
});
