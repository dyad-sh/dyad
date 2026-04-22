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
  let mockContext: AgentContext;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "list-files-test-"),
    );

    await fs.promises.writeFile(path.join(testDir, "src.ts"), "source");
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

    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: testDir,
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
});
