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

describe("extractCodebase", () => {
  let appDir: string | undefined;

  afterEach(async () => {
    if (appDir) {
      await fs.promises.rm(appDir, { recursive: true, force: true });
      appDir = undefined;
    }
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
  });

  const noContext = {
    contextPaths: [],
    smartContextAutoIncludes: [],
  };

  it("counts files and bytes, excluding gitignored files", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, ".gitignore"), "dist\n");
    await fs.promises.mkdir(path.join(appDir, "dist"));
    // 1000 bytes that must not be counted.
    await fs.promises.writeFile(
      path.join(appDir, "dist", "bundle.js"),
      "x".repeat(1000),
    );
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "aaaa\n");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "bb\n");

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    // .gitignore (5) + a.ts (5) + b.ts (3); dist/bundle.js excluded.
    expect(result.sizeStats).toEqual({
      fileCount: 3,
      totalBytes: 13,
    });
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

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.sizeStats?.fileCount).toBe(2);
    expect(result.sizeStats?.totalBytes).toBe(18);
  });

  it("reports app size before per-chat context filtering narrows it", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.mkdir(path.join(appDir, "src"));
    await fs.promises.writeFile(path.join(appDir, "src", "keep.ts"), "keep\n");
    await fs.promises.writeFile(
      path.join(appDir, "src", "other.ts"),
      "other\nlines\nhere\n",
    );

    const unfiltered = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });
    const filtered = await extractCodebase({
      appPath: appDir,
      chatContext: {
        contextPaths: [{ globPath: "src/keep.ts" }],
        smartContextAutoIncludes: [],
      },
    });

    // This is the property the whole metric rests on: two chats against the
    // same app must report the same app size regardless of context config.
    expect(filtered.sizeStats?.fileCount).toBe(unfiltered.sizeStats?.fileCount);
    expect(filtered.sizeStats?.totalBytes).toBe(
      unfiltered.sizeStats?.totalBytes,
    );
    // Only the file list the chat sees narrows.
    expect(filtered.files).toHaveLength(1);
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

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.sizeStats?.fileCount).toBe(2);
    expect(result.sizeStats?.totalBytes).toBe(8);
    // The extraction itself must not emit the file three times either.
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

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.sizeStats).toEqual({
      fileCount: 2,
      totalBytes: 8,
    });
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

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.formattedOutput).toContain(
      "// File contents excluded from context",
    );
    expect(result.sizeStats).toEqual({ fileCount: 2, totalBytes: 14 });
  });

  it("counts an empty file toward the file count but not the byte total", async () => {
    appDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codebase-"));
    await fs.promises.writeFile(path.join(appDir, "a.ts"), "one\ntwo");
    await fs.promises.writeFile(path.join(appDir, "b.ts"), "");

    const result = await extractCodebase({
      appPath: appDir,
      chatContext: noContext,
    });

    expect(result.sizeStats).toEqual({ fileCount: 2, totalBytes: 7 });
  });
});
