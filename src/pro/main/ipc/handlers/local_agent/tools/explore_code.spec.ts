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
  recordCodeExplorerBenchmarkEvent: vi.fn(),
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

vi.mock("../benchmark_recorder", () => ({
  recordCodeExplorerBenchmarkEvent: mocks.recordCodeExplorerBenchmarkEvent,
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

  it("reuses a chat-local report when referenced files are unchanged", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-cache-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, "src/App.tsx"),
      "export const App = 1;\n",
    );
    const ctx = createMockContext(appPath);

    try {
      const first = await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );
      const second = await exploreCodeTool.execute(
        { query: " App   flow ", intent: "locate" },
        ctx,
      );

      expect(first).toBe(second);
      expect(mocks.runExploreCodeSubagent).toHaveBeenCalledTimes(1);
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining('cached="true"'),
      );
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining('intent="locate"'),
      );
      expect(mocks.recordCodeExplorerBenchmarkEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "explore_code_cache_hit" }),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("invalidates a cached report when a referenced file changes", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-cache-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    const appFilePath = path.join(appPath, "src/App.tsx");
    await fs.writeFile(appFilePath, "export const App = 1;\n");
    const ctx = createMockContext(appPath);

    try {
      await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      await fs.writeFile(appFilePath, "export const App = 2;\n");
      await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );

      expect(mocks.runExploreCodeSubagent).toHaveBeenCalledTimes(2);
      expect(ctx.onXmlComplete).toHaveBeenLastCalledWith(
        expect.not.stringContaining('cached="true"'),
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
