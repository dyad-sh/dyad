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
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("streams sub-agent step events while the sub-agent runs", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-stream-"));
    const ctx = createMockContext(appPath);
    mocks.runExploreCodeSubagent.mockImplementation(
      async ({
        onObservation,
      }: {
        onObservation?: (observation: unknown, index: number) => void;
      }) => {
        onObservation?.(
          {
            toolName: "explore_code",
            args: { query: "App flow" },
            result: "observed",
            candidates: [{}, {}],
          },
          0,
        );
        return buildReport("src/App.tsx", "1-10");
      },
    );

    try {
      await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );

      // Meta event streams before the first step.
      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining("<dyad-subagent"),
      );
      // The step summary lives inside a JSON-encoded NDJSON line, so its
      // quotes appear backslash-escaped in the streamed XML body.
      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining('explore_code \\"App flow\\"'),
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("commits a closed dyad-subagent tag with the structured output", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-done-"));
    const ctx = createMockContext(appPath);
    mocks.runExploreCodeSubagent.mockImplementation(
      async ({ onOutput }: { onOutput?: (output: unknown) => void }) => {
        onOutput?.({
          query: "App flow",
          intent: "locate",
          confidence: "high",
          action: "read_targets",
          flow: [
            {
              path: "src/App.tsx",
              range: "1-10",
              role: "entry",
              fact: "App is rendered.",
              quote: "export const App = 1;",
            },
          ],
          readTargets: [],
          missing: [],
          searchTargets: [],
        });
        return buildReport("src/App.tsx", "1-10");
      },
    );

    try {
      const result = await exploreCodeTool.execute(
        { query: "App flow", intent: "locate" },
        ctx,
      );

      // The parent model still receives the text report.
      expect(result).toContain("## explore_code report");

      const finalXml = (ctx.onXmlComplete as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(finalXml).toContain('type="code-explorer"');
      expect(finalXml).toContain('run-id="run_');
      expect(finalXml).toContain('status="completed"');
      expect(finalXml).toContain("</dyad-subagent>");
      expect(finalXml).toContain("high confidence · 1 file");
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("commits an error tag when the sub-agent throws", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "explore-err-"));
    const ctx = createMockContext(appPath);
    mocks.runExploreCodeSubagent.mockRejectedValue(new Error("boom"));

    try {
      await expect(
        exploreCodeTool.execute({ query: "App flow", intent: "locate" }, ctx),
      ).rejects.toThrow("boom");

      const finalXml = (ctx.onXmlComplete as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(finalXml).toContain('status="error"');
      expect(finalXml).toContain("Exploration failed: boom");
      expect(finalXml).toContain("</dyad-subagent>");
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
      expect(xml).toContain("<dyad-subagent");
      expect(xml).toContain('type="code-explorer"');
      expect(xml).toContain('title="App flow"');
      expect(xml).toContain('app-name="other-app"');
      expect(xml).not.toContain("</dyad-subagent>");
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
