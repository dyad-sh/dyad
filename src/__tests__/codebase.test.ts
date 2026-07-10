import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractCodebase, listCodebaseFileMetadata } from "@/utils/codebase";

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
