import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listFilesTool } from "./list_files";
import type { AgentContext } from "./types";
import { DyadErrorKind } from "@/errors/dyad_error";

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

describe("listFilesTool", () => {
  let testDir: string;
  let otherAppDir: string;
  let mockContext: AgentContext;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "list-files-test-"),
    );
    otherAppDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "list-files-other-"),
    );

    await fs.promises.writeFile(path.join(testDir, "src.ts"), "source");
    await fs.promises.writeFile(
      path.join(testDir, "current-a.ts"),
      "export const a = 1;",
    );
    await fs.promises.writeFile(
      path.join(testDir, "current-b.ts"),
      "export const b = 2;",
    );
    await fs.promises.mkdir(path.join(testDir, "nested"));
    await fs.promises.writeFile(
      path.join(testDir, "nested", "deep.ts"),
      "export const deep = 3;",
    );
    await fs.promises.mkdir(path.join(testDir, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(testDir, "node_modules", "pkg", "index.js"),
      "dependency",
    );
    await fs.promises.mkdir(path.join(testDir, ".dyad"), { recursive: true });
    await fs.promises.writeFile(
      path.join(testDir, ".dyad", "snapshot.json"),
      "{}",
    );
    await fs.promises.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.promises.writeFile(
      path.join(testDir, ".git", "config"),
      "should stay hidden",
    );

    await fs.promises.writeFile(
      path.join(otherAppDir, "other-a.ts"),
      "export const otherA = 1;",
    );
    await fs.promises.mkdir(path.join(otherAppDir, "other-nested"));
    await fs.promises.writeFile(
      path.join(otherAppDir, "other-nested", "inside.ts"),
      "export const inside = 2;",
    );

    // Hidden .dyad directory in the referenced app for include_ignored tests
    await fs.promises.mkdir(path.join(otherAppDir, ".dyad"));
    await fs.promises.writeFile(
      path.join(otherAppDir, ".dyad", "rules.md"),
      "# rules",
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
      isDyadPro: false,
      todos: [],
      dyadRequestId: "test-request",
      fileEditTracker: {},
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
      requireConsent: vi.fn().mockResolvedValue(true),
      appendUserMessage: vi.fn(),
      onUpdateTodos: vi.fn(),
    };
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
    await fs.promises.rm(otherAppDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("accepts include_ignored in the schema", () => {
    expect(() =>
      listFilesTool.inputSchema.parse({ include_ignored: true }),
    ).not.toThrow();
  });

  it("includes ignored files when include_ignored is true", async () => {
    const result = await listFilesTool.execute(
      { directory: "node_modules", recursive: true, include_ignored: true },
      mockContext,
    );

    expect(result).toContain(" - node_modules/pkg/");
    expect(result).toContain(" - node_modules/pkg/index.js");
    expect(result).not.toContain(".git/config");
  });

  it("lists directories before files", async () => {
    const result = await listFilesTool.execute(
      { directory: "node_modules", recursive: true, include_ignored: true },
      mockContext,
    );

    const directoryIndex = result.indexOf(" - node_modules/pkg/");
    const fileIndex = result.indexOf(" - node_modules/pkg/index.js");

    expect(directoryIndex).toBeGreaterThanOrEqual(0);
    expect(fileIndex).toBeGreaterThanOrEqual(0);
    expect(directoryIndex).toBeLessThan(fileIndex);
  });

  it("includes include_ignored in XML", async () => {
    await listFilesTool.execute(
      { directory: "node_modules", recursive: true, include_ignored: true },
      mockContext,
    );

    expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('include_ignored="true"'),
    );
  });

  it("rejects recursive ignored listings without a directory", async () => {
    await expect(
      listFilesTool.execute(
        { recursive: true, include_ignored: true },
        mockContext,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message:
        "include_ignored=true with recursive=true requires a non-root directory to avoid listing too many files.",
    });
  });

  it("rejects recursive ignored listings for the app root", async () => {
    await expect(
      listFilesTool.execute(
        { directory: ".", recursive: true, include_ignored: true },
        mockContext,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message:
        "include_ignored=true with recursive=true requires a non-root directory to avoid listing too many files.",
    });
  });

  it("caps returned paths at 1000", async () => {
    const generatedDir = path.join(testDir, "generated");
    await fs.promises.mkdir(generatedDir);
    await Promise.all(
      Array.from({ length: 1005 }, (_, index) =>
        fs.promises.writeFile(
          path.join(generatedDir, `file-${String(index).padStart(4, "0")}.txt`),
          "generated",
        ),
      ),
    );

    const result = await listFilesTool.execute(
      { directory: "generated", recursive: true, include_ignored: true },
      mockContext,
    );

    const listedPathCount = result
      .split("\n")
      .filter((line) => line.startsWith(" - ")).length;

    expect(listedPathCount).toBe(1000);
    expect(result).toContain("[TRUNCATED: Showing 1000 of ");
    expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('truncated="true"'),
    );
  });

  describe("schema", () => {
    it("has the correct name", () => {
      expect(listFilesTool.name).toBe("list_files");
    });

    it("accepts optional app_name", () => {
      const parsed = listFilesTool.inputSchema.parse({
        app_name: "other-app",
      });
      expect(parsed.app_name).toBe("other-app");
    });
  });

  describe("getConsentPreview", () => {
    it("omits app suffix when app_name is absent", () => {
      expect(listFilesTool.getConsentPreview?.({ directory: "src" })).toBe(
        "List src",
      );
      expect(listFilesTool.getConsentPreview?.({})).toBe("List all files");
    });

    it("uses consistent trailing (app: <name>) format for both dir and no-dir cases", () => {
      expect(
        listFilesTool.getConsentPreview?.({
          directory: "src/components",
          app_name: "other-app",
        }),
      ).toBe("List src/components (app: other-app)");
      expect(listFilesTool.getConsentPreview?.({ app_name: "other-app" })).toBe(
        "List all files (app: other-app)",
      );
    });

    it("includes recursive and include_ignored flags before app suffix", () => {
      expect(
        listFilesTool.getConsentPreview?.({
          directory: "src",
          recursive: true,
          include_ignored: true,
          app_name: "other-app",
        }),
      ).toBe("List src (recursive) (include ignored) (app: other-app)");
    });
  });

  describe("buildXml (streaming)", () => {
    it("includes app_name attribute when provided", () => {
      const xml = listFilesTool.buildXml?.(
        { directory: "src", app_name: "other-app" },
        false,
      );
      expect(xml).toContain('app_name="other-app"');
      expect(xml).toContain('directory="src"');
    });

    it("omits app_name attribute when not provided", () => {
      const xml = listFilesTool.buildXml?.({ directory: "src" }, false);
      expect(xml).not.toContain("app_name=");
    });

    it("returns undefined when complete (execute handles final XML)", () => {
      const xml = listFilesTool.buildXml?.({ app_name: "other-app" }, true);
      expect(xml).toBeUndefined();
    });
  });

  describe("execute - app_name (referenced apps)", () => {
    it("lists files from the referenced app's path (non-recursive)", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await listFilesTool.execute(
        { app_name: "other-app" },
        mockContext,
      );
      expect(result).toContain("other-a.ts");
      expect(result).not.toContain("current-a.ts");
    });

    it("lists files recursively from the referenced app", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await listFilesTool.execute(
        { app_name: "other-app", recursive: true },
        mockContext,
      );
      expect(result).toContain("other-a.ts");
      expect(result).toContain("other-nested/inside.ts");
    });

    it("throws a clear error when app_name is unknown", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await expect(
        listFilesTool.execute({ app_name: "does-not-exist" }, mockContext),
      ).rejects.toThrow(/Unknown app_name 'does-not-exist'/);
    });

    it("excludes .dyad files from referenced apps even when include_ignored is true", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await listFilesTool.execute(
        {
          app_name: "other-app",
          directory: ".dyad",
          include_ignored: true,
          recursive: true,
        },
        mockContext,
      );
      expect(result).not.toContain(".dyad/rules.md");
    });

    it("excludes .dyad files from referenced apps in the default (non-include_ignored) listing", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await listFilesTool.execute(
        { app_name: "other-app", recursive: true },
        mockContext,
      );
      expect(result).not.toContain(".dyad/rules.md");
      expect(result).toContain("other-a.ts");
    });

    it("emits app_name attribute in the final XML output", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await listFilesTool.execute({ app_name: "other-app" }, mockContext);
      const xmlCall = (mockContext.onXmlComplete as any).mock.calls[0]?.[0];
      expect(xmlCall).toContain('app_name="other-app"');
    });

    it("operates on current app when app_name is omitted even if referencedApps is populated", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await listFilesTool.execute({}, mockContext);
      expect(result).toContain("current-a.ts");
      expect(result).not.toContain("other-a.ts");
    });
  });
});
