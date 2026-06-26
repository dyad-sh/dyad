import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { exploreCodeTool } from "./explore_code";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  getCodeExplorerAvailability: vi.fn(),
  formatCodeExplorerDisabledReason: vi.fn(),
  runExploreCodeSubagent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("@/ipc/processors/code_explorer", () => ({
  getCodeExplorerAvailability: mocks.getCodeExplorerAvailability,
  formatCodeExplorerDisabledReason: mocks.formatCodeExplorerDisabledReason,
}));

vi.mock("./explore_code_subagent", () => ({
  runExploreCodeSubagent: mocks.runExploreCodeSubagent,
}));

describe("exploreCodeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ enableCodeExplorer: true });
    mocks.getCodeExplorerAvailability.mockReturnValue({
      ready: true,
      reason: null,
      tsconfigPath: "tsconfig.json",
    });
    mocks.runExploreCodeSubagent.mockResolvedValue(
      buildReport("src/App.tsx", "1-10"),
    );
  });

  it("is treated as engine-backed so Dyad Free model turns filter it out", () => {
    expect(exploreCodeTool.usesEngineEndpoint).toBe(true);
  });

  it("runs the sub-agent on every call (no report cache)", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "src/App.tsx"),
      "export const App = 1;\n",
    );
    const ctx = createMockContext(appPath);

    try {
      await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );
      // Same normalized query: with no cache, this still re-runs the sub-agent.
      await exploreCodeTool.execute(
        { query: " App   flow ", intent: "locate" },
        ctx,
      );

      expect(mocks.runExploreCodeSubagent).toHaveBeenCalledTimes(2);
      expect(ctx.onXmlComplete).not.toHaveBeenCalledWith(
        expect.stringContaining('cached="true"'),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("preserves the caller-supplied intent without query-based promotion", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-cache-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "src/App.tsx"),
      "export const App = 1;\n",
    );
    const ctx = createMockContext(appPath);

    try {
      await exploreCodeTool.execute(
        {
          query:
            "Trace how booking availability is computed and surfaced to the page",
          intent: "locate",
        },
        ctx,
      );

      expect(mocks.runExploreCodeSubagent).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ intent: "locate" }),
        }),
      );
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining('intent="locate"'),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("streams in-progress XML while the sub-agent runs", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-stream-"));
    const ctx = createMockContext(appPath);
    mocks.runExploreCodeSubagent.mockImplementation(
      async ({
        onProgress,
      }: {
        onProgress?: (progressText: string) => void;
      }) => {
        onProgress?.(
          'Exploring...\n\n1. explore_code "App flow" → 2 candidates',
        );
        return buildReport("src/App.tsx", "1-10");
      },
    );

    try {
      await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );

      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining("Exploring..."),
      );
      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining('1. explore_code "App flow" → 2 candidates'),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("falls back to the detected tsconfig when the supplied path is stale", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-cache-"));
    await fs.writeFile(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({ compilerOptions: {} }),
    );
    const ctx = createMockContext(appPath);

    try {
      await exploreCodeTool.execute(
        {
          query: "App flow with stale tsconfig",
          intent: "locate",
          tsconfig_path: "webapp/tsconfig.json",
        },
        ctx,
      );

      expect(mocks.runExploreCodeSubagent).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ tsconfig_path: "tsconfig.json" }),
        }),
      );
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining('tsconfig_path="tsconfig.json"'),
      );
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.not.stringContaining("webapp/tsconfig.json"),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  describe("buildXml", () => {
    it("returns undefined when query is missing", () => {
      const xml = exploreCodeTool.buildXml?.({}, false);
      expect(xml).toBeUndefined();
    });

    it("returns undefined when complete (execute handles final XML)", () => {
      const xml = exploreCodeTool.buildXml?.(
        { query: "App flow", intent: "locate" },
        true,
      );
      expect(xml).toBeUndefined();
    });

    it("builds an unclosed in-progress tag while streaming", () => {
      const xml = exploreCodeTool.buildXml?.(
        { query: "App flow", intent: "locate", app_name: "other-app" },
        false,
      );
      expect(xml).toContain("<dyad-explore-code");
      expect(xml).toContain('query="App flow"');
      expect(xml).toContain('intent="locate"');
      expect(xml).toContain('app_name="other-app"');
      expect(xml).toContain("Exploring...");
      expect(xml).not.toContain("</dyad-explore-code>");
    });
  });
});

function buildReport(filePath: string, range: string): string {
  return [
    "## explore_code report",
    `Query: "App flow" | Intent: locate | Confidence: high | Action: read_targets`,
    "Flow:",
    `1. ${filePath}:${range} (entry) - App is rendered.`,
    "> export const App = 1;",
    "```json",
    JSON.stringify({
      action: "read_targets",
      confidence: "high",
      paths: [
        {
          path: filePath,
          range,
        },
      ],
    }),
    "```",
  ].join("\n");
}

function createMockContext(appPath: string): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath,
    referencedApps: new Map(),
    chatId: 99,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 3,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    chatSummary: undefined,
    todos: [],
    dyadRequestId: "request-id",
    fileEditTracker: {},
    isDyadPro: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}
