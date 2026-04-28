import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { codeSearchTool } from "./code_search";
import type { AgentContext } from "./types";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const engineFetchMock = vi.fn();
vi.mock("./engine_fetch", () => ({
  engineFetch: (...args: any[]) => engineFetchMock(...args),
}));

function mockEngineResponse(relevantFiles: string[]) {
  engineFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    json: async () => ({ relevantFiles }),
  } as any);
}

describe("codeSearchTool", () => {
  let testDir: string;
  let otherAppDir: string;
  let mockContext: AgentContext;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "code-search-test-"),
    );
    otherAppDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "code-search-other-"),
    );

    await fs.promises.writeFile(
      path.join(testDir, "current.ts"),
      `export const foo = "current-app-file";`,
    );
    await fs.promises.writeFile(
      path.join(otherAppDir, "other.ts"),
      `export const bar = "other-app-file";`,
    );

    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: testDir,
      referencedApps: new Map(),
      chatId: 1,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      neonProjectId: null,
      neonActiveBranchId: null,
      frameworkType: null,
      messageId: 1,
      isSharedModulesChanged: false,
      isDyadPro: true,
      todos: [],
      dyadRequestId: "test-request",
      fileEditTracker: {},
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
      requireConsent: vi.fn().mockResolvedValue(true),
      appendUserMessage: vi.fn(),
      onUpdateTodos: vi.fn(),
    };

    engineFetchMock.mockReset();
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
    await fs.promises.rm(otherAppDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("schema", () => {
    it("has the correct name", () => {
      expect(codeSearchTool.name).toBe("code_search");
    });

    it("accepts optional app_name", () => {
      const parsed = codeSearchTool.inputSchema.parse({
        query: "foo",
        app_name: "other-app",
      });
      expect(parsed.app_name).toBe("other-app");
    });
  });

  describe("getConsentPreview", () => {
    it("omits app label when app_name is not provided", () => {
      const preview = codeSearchTool.getConsentPreview?.({ query: "foo" });
      expect(preview).toBe('Search for "foo"');
    });

    it("appends (app: <name>) when app_name is provided", () => {
      const preview = codeSearchTool.getConsentPreview?.({
        query: "foo",
        app_name: "other-app",
      });
      expect(preview).toBe('Search for "foo" (app: other-app)');
    });
  });

  describe("buildXml", () => {
    it("includes app_name attribute while streaming when provided", () => {
      const xml = codeSearchTool.buildXml?.(
        { query: "foo", app_name: "other-app" },
        false,
      );
      expect(xml).toContain('app_name="other-app"');
      expect(xml).toContain('query="foo"');
    });

    it("omits app_name attribute while streaming when not provided", () => {
      const xml = codeSearchTool.buildXml?.({ query: "foo" }, false);
      expect(xml).not.toContain("app_name=");
    });

    it("returns undefined when complete (execute handles final XML)", () => {
      const xml = codeSearchTool.buildXml?.(
        { query: "foo", app_name: "other-app" },
        true,
      );
      expect(xml).toBeUndefined();
    });
  });

  describe("execute - app_name (referenced apps)", () => {
    it("routes to the referenced app's path when app_name matches", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      mockEngineResponse(["other.ts"]);

      await codeSearchTool.execute(
        { query: "bar", app_name: "other-app" },
        mockContext,
      );

      expect(engineFetchMock).toHaveBeenCalledTimes(1);
      const [, , opts] = engineFetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      // The referenced app's file should be the one searched — not the current app's file.
      const searchedPaths = body.filesContext.map(
        (f: { path: string }) => f.path,
      );
      expect(searchedPaths).toContain("other.ts");
      expect(searchedPaths).not.toContain("current.ts");
    });

    it("throws a clear error when app_name is not in the allow-list", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await expect(
        codeSearchTool.execute(
          { query: "bar", app_name: "does-not-exist" },
          mockContext,
        ),
      ).rejects.toThrow(/Unknown app_name 'does-not-exist'/);
      expect(engineFetchMock).not.toHaveBeenCalled();
    });

    it("emits app_name in the final XML output", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      mockEngineResponse(["other.ts"]);

      await codeSearchTool.execute(
        { query: "bar", app_name: "other-app" },
        mockContext,
      );

      const xmlCall = (mockContext.onXmlComplete as any).mock.calls[0]?.[0];
      expect(xmlCall).toContain('app_name="other-app"');
      expect(xmlCall).toContain('query="bar"');
    });

    it("omits app_name from final XML when not provided", async () => {
      mockEngineResponse(["current.ts"]);

      await codeSearchTool.execute({ query: "foo" }, mockContext);

      const xmlCall = (mockContext.onXmlComplete as any).mock.calls[0]?.[0];
      expect(xmlCall).not.toContain("app_name=");
    });
  });
});
