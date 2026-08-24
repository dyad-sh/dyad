import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractCodebase, listCodebaseFileMetadata } from "@/utils/codebase";
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
    enableDyadPro: false,
    enableProSmartFilesContextMode: false,
  })),
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitListFilesNative: vi.fn(async () => {
    throw new Error("Git unavailable in filesystem traversal tests");
  }),
}));

afterEach(() => {
  // Re-arm the default. A test that fails before consuming its
  // mockResolvedValueOnce would otherwise leak that value into the next one
  // and silently switch it to the native-Git branch.
  vi.mocked(gitListFilesNative).mockReset();
  vi.mocked(gitListFilesNative).mockImplementation(async () => {
    throw new Error("Git unavailable in filesystem traversal tests");
  });
});

describe("extractCodebase", () => {
  let appDir: string | undefined;

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

  it("honors nested gitignore rules without a Git repository", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src"), { recursive: true });
    await fs.promises.mkdir(path.join(appDir, "private"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(appDir, ".gitignore"),
      "secret.json\nprivate/\n",
    );
    await fs.promises.writeFile(
      path.join(appDir, "src", ".gitignore"),
      "ignored.ts\n",
    );
    await fs.promises.writeFile(
      path.join(appDir, "secret.json"),
      '{"token":"secret"}',
    );
    await fs.promises.writeFile(
      path.join(appDir, "private", "credentials.ts"),
      'export const password = "secret";',
    );
    await fs.promises.writeFile(
      path.join(appDir, "src", "ignored.ts"),
      'export const ignored = "secret";',
    );
    await fs.promises.writeFile(
      path.join(appDir, "src", "visible.ts"),
      "export const visible = true;",
    );

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
      },
    });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      ".gitignore",
      "src/.gitignore",
      "src/visible.ts",
    ]);
    expect(result.formattedOutput).not.toContain('{"token":"secret"}');
    expect(result.formattedOutput).not.toContain(
      'export const password = "secret";',
    );
  });

  it("lists file metadata without reading file contents", async () => {
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
});

describe("extractCodebase size stats", () => {
  let appDir: string | undefined;

  afterEach(async () => {
    if (appDir) {
      await fs.promises.rm(appDir, { recursive: true, force: true });
      appDir = undefined;
    }
    vi.restoreAllMocks();
  });

  const noContext = {
    contextPaths: [],
    smartContextAutoIncludes: [],
  };

  /** Captures what the extraction reports, which is the only way it is read. */
  async function sizeOf(
    dir: string,
    chatContext: Parameters<
      typeof extractCodebase
    >[0]["chatContext"] = noContext,
  ) {
    let sizeStats: unknown;
    await extractCodebase({
      appPath: dir,
      chatContext,
      onSizeStats: (stats) => {
        sizeStats = stats;
      },
    });
    return sizeStats;
  }

  it("counts files and bytes, excluding gitignored files", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    // secret.json is dropped by the gitignore rule alone: nothing in
    // EXCLUDED_DIRS or EXCLUDED_FILES would exclude it.
    await fs.promises.writeFile(
      path.join(appDir, ".gitignore"),
      "secret.json\n",
    );
    // 1000 bytes that must not be counted.
    await fs.promises.writeFile(
      path.join(appDir, "secret.json"),
      "x".repeat(1000),
    );
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "bb\n");

    // .gitignore (12) + a.ts (5) + b.ts (3); secret.json excluded.
    expect(await sizeOf(appDir)).toEqual({ fileCount: 3, totalBytes: 20 });
  });

  it("counts files and bytes, excluding build output directories", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "dist"));
    // dist is in EXCLUDED_DIRS, so it is dropped with no gitignore rule.
    await fs.promises.writeFile(
      path.join(appDir, "dist", "bundle.js"),
      "x".repeat(1000),
    );
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");

    expect(await sizeOf(appDir)).toEqual({ fileCount: 1, totalBytes: 5 });
  });

  it("counts files whose contents are withheld from the model", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    // .bin is outside ALLOWED_EXTENSIONS, so it reaches the model as a path
    // with placeholder content. It is still part of the app, so it counts.
    await fs.promises.writeFile(
      path.join(appDir, "data.bin"),
      "1\n2\n3\n4\n5\n",
    );
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "one\ntwo\n");

    expect(await sizeOf(appDir)).toEqual({ fileCount: 2, totalBytes: 18 });
  });

  it("counts an empty file toward the file count but not the byte total", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "one\ntwo");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "");

    expect(await sizeOf(appDir)).toEqual({ fileCount: 2, totalBytes: 7 });
  });

  it("counts a conflicted file once, not once per index stage", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "f.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "other.ts"), "bb\n");
    // During a merge conflict `git ls-files` prints the unmerged path once per
    // index stage, so the same path arrives three times. Only one file exists
    // on disk, so it must be counted once.
    vi.mocked(gitListFilesNative).mockResolvedValueOnce([
      "f.ts",
      "f.ts",
      "f.ts",
      "other.ts",
    ]);

    expect(await sizeOf(appDir)).toEqual({ fileCount: 2, totalBytes: 8 });
  });

  it("does not let an extraction emit a conflicted file more than once", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "f.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "other.ts"), "bb\n");
    vi.mocked(gitListFilesNative).mockResolvedValueOnce([
      "f.ts",
      "f.ts",
      "f.ts",
      "other.ts",
    ]);

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      "f.ts",
      "other.ts",
    ]);
  });

  it("counts bytes on the native Git path too", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "bb\n");
    // The suite otherwise forces the traversal fallback; exercise the path
    // that actually runs in production.
    vi.mocked(gitListFilesNative).mockResolvedValueOnce(["a.ts", "b.ts"]);

    expect(await sizeOf(appDir)).toEqual({ fileCount: 2, totalBytes: 8 });
  });

  it("reports the same size whichever way the prompt is assembled", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src", "components", "ui"), {
      recursive: true,
    });
    // src/components/ui reaches the model as a placeholder, but it is still
    // part of the app. Size comes from the filesystem, never from how the
    // prompt happens to be built.
    await fs.promises.writeFile(
      path.join(appDir, "src", "components", "ui", "button.tsx"),
      "a\nb\nc\nd\ne\n",
    );
    await fs.promises.writeFile(path.join(appDir, "src", "app.tsx"), "one\n");

    expect(await sizeOf(appDir)).toEqual({ fileCount: 2, totalBytes: 14 });
  });

  it("reports the same size regardless of per-chat context filtering", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src"));
    await fs.promises.writeFile(path.join(appDir, "src", "keep.ts"), "keep\n");
    await fs.promises.writeFile(
      path.join(appDir, "src", "other.ts"),
      "other\nlines\nhere\n",
    );

    const unfiltered = await sizeOf(appDir);
    const filtered = await sizeOf(appDir, {
      contextPaths: [{ globPath: "src/keep.ts" }],
      smartContextAutoIncludes: [],
    });

    // This is the property the whole metric rests on: two chats against the
    // same app must report the same app size regardless of context config.
    expect(filtered).toEqual(unfiltered);
  });

  it("reports the size before reading any file contents", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "bb\n");
    const readFileSpy = vi.spyOn(fs.promises, "readFile");
    let readsWhenReported = -1;

    await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
      onSizeStats: () => {
        readsWhenReported = readFileSpy.mock.calls.length;
      },
    });

    // A turn that dies reading a large codebase must still have reported its
    // size, so the callback has to fire before any content is read.
    expect(readsWhenReported).toBe(0);
    expect(readFileSpy).toHaveBeenCalled();
  });

  it("reports nothing when the app directory cannot be read", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    const onSizeStats = vi.fn();
    // The directory exists, so the existence check passes, but the walk finds
    // nothing. A zero would land in the small-app bucket as a real reading.
    vi.spyOn(fs.promises, "readdir").mockRejectedValue(
      new Error("permission denied"),
    );

    await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
      onSizeStats,
    });

    expect(onSizeStats).not.toHaveBeenCalled();
  });

  it("reports nothing when part of the tree cannot be read", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "src", "b.ts"), "bb\n");
    const onSizeStats = vi.fn();
    // One unreadable file makes the count an undercount by an unknown amount,
    // which is indistinguishable from a genuinely smaller app.
    const realStat = fs.promises.stat;
    vi.spyOn(fs.promises, "stat").mockImplementation(
      async (target, ...rest) => {
        if (String(target).endsWith("b.ts")) {
          throw new Error("permission denied");
        }
        return realStat(target, ...(rest as []));
      },
    );

    await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
      onSizeStats,
    });

    expect(onSizeStats).not.toHaveBeenCalled();
  });

  it("is not called for a directory that does not exist", async () => {
    const onSizeStats = vi.fn();

    await extractCodebase({
      appPath: path.join(os.tmpdir(), "codebase-missing-dir"),
      chatContext: noContext,
      onSizeStats,
    });

    expect(onSizeStats).not.toHaveBeenCalled();
  });
});
