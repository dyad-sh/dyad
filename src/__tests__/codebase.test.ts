import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractCodebase,
  formatCodebaseTruncationWarning,
  listCodebaseFileMetadata,
  mapWithConcurrency,
} from "@/utils/codebase";
import { readSettings } from "@/main/settings";
import { AsyncVirtualFileSystem } from "../../shared/VirtualFilesystem";
import { gitListFilesNative } from "@/ipc/utils/git_utils";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    enableNativeGit: false,
    enableDyadPro: false,
    enableProSmartFilesContextMode: false,
  })),
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitIsIgnoredIso: vi.fn(async () => false),
  gitListFilesNative: vi.fn(async () => []),
}));

describe("extractCodebase", () => {
  let appDir: string | undefined;

  beforeEach(() => {
    vi.mocked(gitListFilesNative).mockReset().mockResolvedValue([]);
    vi.mocked(readSettings).mockReturnValue({
      enableNativeGit: false,
      enableDyadPro: false,
      enableProSmartFilesContextMode: false,
    } as ReturnType<typeof readSettings>);
  });

  afterEach(async () => {
    if (appDir) {
      await fs.promises.rm(appDir, { recursive: true, force: true });
      appDir = undefined;
    }
    vi.restoreAllMocks();
  });

  it("includes shader source file contents", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src", "shaders"), {
      recursive: true,
    });

    await fs.promises.writeFile(
      path.join(appDir, "src", "shaders", "scene.wgsl"),
      "fn vertexMain() -> void {}",
    );
    await fs.promises.writeFile(
      path.join(appDir, "src", "shaders", "material.frag"),
      "void main() { gl_FragColor = vec4(1.0); }",
    );
    await fs.promises.writeFile(
      path.join(appDir, "src", "notes.shader"),
      "custom shader notes",
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
    });

    expect(result.files).toContainEqual({
      path: "src/shaders/scene.wgsl",
      content: "fn vertexMain() -> void {}",
      force: false,
    });
    expect(result.files).toContainEqual({
      path: "src/shaders/material.frag",
      content: "void main() { gl_FragColor = vec4(1.0); }",
      force: false,
    });
    expect(result.files).toContainEqual({
      path: "src/notes.shader",
      content: "// File contents excluded from context",
      force: false,
    });
  });

  it("excludes git metadata policy files from context", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));

    await fs.promises.writeFile(
      path.join(appDir, ".gitattributes"),
      "* text=auto eol=lf\n",
    );
    await fs.promises.writeFile(path.join(appDir, ".gitignore"), "dist\n");
    await fs.promises.writeFile(path.join(appDir, "src.ts"), "export {};\n");

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
    });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      ".gitignore",
      "src.ts",
    ]);
    expect(result.formattedOutput).not.toContain(".gitattributes");
  });

  it("deterministically truncates at the aggregate byte budget", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "bbbb");
    await fs.promises.writeFile(path.join(appDir, "c.ts"), "c");
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    await Promise.all(
      ["a.ts", "b.ts", "c.ts"].map((fileName) =>
        fs.promises.utimes(path.join(appDir!, fileName), fixedTime, fixedTime),
      ),
    );

    const extract = () =>
      extractCodebase({
        appPath: appDir!,
        chatContext: {
          contextPaths: [],
          smartContextAutoIncludes: [],
        },
        limits: {
          maxFiles: 10,
          maxTotalBytes: 5,
          ioConcurrency: 2,
        },
      });

    const firstResult = await extract();
    const secondResult = await extract();

    expect(firstResult.files.map((file) => file.path)).toEqual([
      "a.ts",
      "c.ts",
    ]);
    expect(secondResult).toEqual(firstResult);
    expect(firstResult.truncation).toEqual({
      totalFileCount: 3,
      includedFileCount: 2,
      omittedFileCount: 1,
      includedContentBytes: 5,
      maxFiles: 10,
      maxTotalBytes: 5,
      reasons: ["total-bytes"],
    });
    expect(firstResult.formattedOutput).toContain(
      '<dyad-codebase-truncated included_files="2" omitted_files="1" included_content_bytes="5" max_files="10" max_total_bytes="5" reasons="total-bytes" />',
    );
  });

  it("applies the file-count limit at its exact boundary", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fs.promises.writeFile(
          path.join(appDir!, `file-${index}.ts`),
          String(index),
        ),
      ),
    );
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fs.promises.utimes(
          path.join(appDir!, `file-${index}.ts`),
          fixedTime,
          fixedTime,
        ),
      ),
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
      limits: {
        maxFiles: 3,
        maxTotalBytes: 100,
      },
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "file-0.ts",
      "file-1.ts",
      "file-2.ts",
    ]);
    expect(result.truncation).toMatchObject({
      totalFileCount: 5,
      includedFileCount: 3,
      omittedFileCount: 2,
      reasons: ["file-count"],
    });
  });

  it("reports both limits when omitted files exceed the remaining byte budget", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await Promise.all(
      ["a.ts", "b.ts", "c.ts"].map((file) =>
        fs.promises.writeFile(path.join(appDir!, file), "data"),
      ),
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      limits: { maxFiles: 2, maxTotalBytes: 8 },
    });

    expect(result.truncation?.reasons).toEqual(["file-count", "total-bytes"]);
  });

  it("conservatively budgets real files whose final stat fails", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "unstable.ts"), "content");
    vi.mocked(readSettings).mockReturnValue({
      enableNativeGit: true,
      enableDyadPro: false,
      enableProSmartFilesContextMode: false,
    } as ReturnType<typeof readSettings>);
    vi.mocked(gitListFilesNative).mockResolvedValue(["unstable.ts"]);
    vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(
      new Error("transient stat failure"),
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      limits: { maxFiles: 10, maxTotalBytes: 100 },
    });

    expect(result.files).toEqual([]);
    expect(result.includedContentBytes).toBe(0);
    expect(result.truncation?.reasons).toEqual(["total-bytes"]);
  });

  it("does not spend the byte budget on normally omitted file contents", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src", "components", "ui"), {
      recursive: true,
    });
    await fs.promises.writeFile(path.join(appDir, "app.ts"), "a");
    await fs.promises.writeFile(
      path.join(appDir, "src", "components", "ui", "Button.tsx"),
      "export const Button = () => null;",
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
      limits: {
        maxFiles: 10,
        maxTotalBytes: 1,
      },
    });

    expect(result.files).toHaveLength(2);
    expect(result.files).toContainEqual({
      path: "app.ts",
      content: "a",
      force: false,
    });
    expect(result.files).toContainEqual({
      path: "src/components/ui/Button.tsx",
      content: "// File contents excluded from context",
      force: false,
    });
    expect(result.truncation).toBeUndefined();
  });

  it("formats truncation warnings for files-only consumers", () => {
    expect(
      formatCodebaseTruncationWarning({
        totalFileCount: 10,
        includedFileCount: 4,
        omittedFileCount: 6,
        includedContentBytes: 123,
        maxFiles: 4,
        maxTotalBytes: 1_000,
        reasons: ["file-count"],
      }),
    ).toBe(
      "Codebase context is incomplete: 4 of 10 files were included (6 omitted; limits reached: file-count). Results based only on the included files may be incomplete.",
    );
  });

  it("formats a clear warning when a shared budget prevents scanning", () => {
    expect(
      formatCodebaseTruncationWarning({
        totalFileCount: 0,
        includedFileCount: 0,
        omittedFileCount: 0,
        includedContentBytes: 0,
        maxFiles: 0,
        maxTotalBytes: 100,
        reasons: ["file-count"],
        budgetExhaustedBeforeScan: true,
      }),
    ).toBe(
      "Codebase context was not scanned because the shared extraction budget was already exhausted (limits reached: file-count). Results do not include files from this app.",
    );
  });

  it("prioritizes forced smart-context files when a budget truncates", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "a");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "b");
    await fs.promises.writeFile(path.join(appDir, "forced.ts"), "forced");
    vi.mocked(readSettings).mockReturnValue({
      enableNativeGit: false,
      enableDyadPro: true,
      enableProSmartFilesContextMode: true,
    } as ReturnType<typeof readSettings>);

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [{ globPath: "forced.ts" }],
      },
      limits: {
        maxFiles: 1,
        maxTotalBytes: 100,
      },
    });

    expect(result.files).toEqual([
      { path: "forced.ts", content: "forced", force: true },
    ]);
  });

  it("bounds concurrent reads and reads each selected file once", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    const fileCount = 12;
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        fs.promises.writeFile(
          path.join(appDir!, `file-${String(index).padStart(2, "0")}.ts`),
          `export const value${index} = ${index};`,
        ),
      ),
    );

    let activeReads = 0;
    let maxActiveReads = 0;
    let totalReads = 0;
    const virtualFileSystem = new AsyncVirtualFileSystem(appDir, {
      readFile: async (fileName) => {
        activeReads++;
        totalReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await fs.promises.readFile(fileName, "utf8");
        } finally {
          activeReads--;
        }
      },
    });

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
      virtualFileSystem,
      limits: {
        maxFiles: fileCount,
        maxTotalBytes: 10_000,
        ioConcurrency: 3,
      },
    });

    expect(result.files).toHaveLength(fileCount);
    expect(totalReads).toBe(fileCount);
    expect(maxActiveReads).toBeLessThanOrEqual(3);
  });

  it("stops concurrency workers after the first mapper failure", async () => {
    const startedIndexes: number[] = [];

    await expect(
      mapWithConcurrency([0, 1, 2, 3], 2, async (_item, index) => {
        startedIndexes.push(index);
        if (index === 0) {
          throw new Error("mapper failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return index;
      }),
    ).rejects.toThrow("mapper failed");

    expect(startedIndexes).toEqual([0, 1]);
  });

  it("uses stable path ordering when virtual-file stats are unavailable", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    const virtualFileSystem = new AsyncVirtualFileSystem(appDir);
    virtualFileSystem.applyResponseChanges({
      deletePaths: [],
      renameTags: [],
      writeTags: [
        { path: "b.ts", content: "b" },
        { path: "a.ts", content: "a" },
      ],
    });

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      virtualFileSystem,
      limits: { maxFiles: 1, maxTotalBytes: 100 },
    });

    expect(result.files.map((file) => file.path)).toEqual(["a.ts"]);
  });

  it("lists metadata without reading file contents", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "secret content");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "more content");
    const readFileSpy = vi.spyOn(fs.promises, "readFile");

    const result = await listCodebaseFileMetadata({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
    });

    expect(result.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.totalFileCount).toBe(2);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("bounds metadata results while retaining the total file count", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await Promise.all(
      ["a.ts", "b.ts", "c.ts"].map((file) =>
        fs.promises.writeFile(path.join(appDir!, file), file),
      ),
    );

    const result = await listCodebaseFileMetadata({
      appPath: appDir,
      chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      maxFiles: 2,
    });

    expect(result.files).toHaveLength(2);
    expect(result.totalFileCount).toBe(3);
  });
});
