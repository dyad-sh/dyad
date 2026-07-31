import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appPath: "",
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitResetFile: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(
    (
      contract: { channel: string },
      handler: (...args: any[]) => Promise<unknown>,
    ) => {
      mocks.handlers.set(contract.channel, handler);
    },
  ),
}));

vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findFirst } } },
}));

vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: () => mocks.appPath }));
vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd: mocks.gitAdd,
  gitCommit: mocks.gitCommit,
  gitResetFile: mocks.gitResetFile,
}));
vi.mock("@/ipc/handlers/gitignoreUtils", () => ({
  ensureDyadGitignored: vi.fn(),
}));
vi.mock("@/utils/style-utils", () => ({
  stylesToTailwind: () => ["ml-2"],
  extractClassPrefixes: () => ["ml"],
}));
vi.mock("@/ipc/utils/visual_editing_utils", () => ({
  transformContent: (content: string) => `${content}\nchanged`,
  analyzeComponent: vi.fn(),
}));

import { registerVisualEditingHandlers } from "./visual_editing_handlers";
import { visualEditingContracts } from "@/ipc/types/visual-editing";

describe("visual editing handlers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-visual-edit-"),
    );
    await fs.mkdir(path.join(mocks.appPath, ".git"));
    await fs.writeFile(path.join(mocks.appPath, "One.tsx"), "one");
    await fs.writeFile(path.join(mocks.appPath, "Two.tsx"), "two");
    mocks.findFirst.mockResolvedValue({ id: 1, path: "unused" });
    registerVisualEditingHandlers();
  });

  afterEach(async () => {
    await fs.rm(mocks.appPath, { recursive: true, force: true });
  });

  it("commits all changed source files as one batch", async () => {
    const handler = mocks.handlers.get(
      visualEditingContracts.applyChanges.channel,
    );
    expect(handler).toBeDefined();

    await handler!(
      {},
      {
        appId: 1,
        changes: [
          {
            componentId: "One.tsx:1:1",
            componentName: "div",
            relativePath: "One.tsx",
            lineNumber: 1,
            styles: { margin: { left: "8px" } },
          },
          {
            componentId: "Two.tsx:1:1",
            componentName: "div",
            relativePath: "Two.tsx",
            lineNumber: 1,
            styles: { margin: { left: "8px" } },
          },
        ],
      },
    );

    expect(mocks.gitAdd).not.toHaveBeenCalled();
    expect(mocks.gitCommit).toHaveBeenCalledOnce();
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: mocks.appPath,
      message: "Apply visual editing changes",
      paths: ["One.tsx", "Two.tsx"],
    });
  });

  it("uses distinct paths for same-named image uploads", async () => {
    const handler = mocks.handlers.get(
      visualEditingContracts.applyChanges.channel,
    );
    expect(handler).toBeDefined();

    await handler!(
      {},
      {
        appId: 1,
        changes: [
          {
            componentId: "One.tsx:1:1",
            componentName: "img",
            relativePath: "One.tsx",
            lineNumber: 1,
            styles: {},
            imageUpload: {
              fileName: "photo.png",
              base64Data: "data:image/png;base64,YQ==",
              mimeType: "image/png",
            },
          },
          {
            componentId: "Two.tsx:1:1",
            componentName: "img",
            relativePath: "Two.tsx",
            lineNumber: 1,
            styles: {},
            imageUpload: {
              fileName: "photo.png",
              base64Data: "data:image/png;base64,Yg==",
              mimeType: "image/png",
            },
          },
        ],
      },
    );

    const imagePaths = mocks.gitAdd.mock.calls.map(
      ([params]) => params.filepath as string,
    );
    expect(imagePaths).toHaveLength(2);
    expect(new Set(imagePaths).size).toBe(2);
  });

  it("rejects source files that escape the app through a symlink", async () => {
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-visual-edit-outside-"),
    );
    const outsideFile = path.join(outsideDir, "Outside.tsx");
    await fs.writeFile(outsideFile, "outside");
    await fs.symlink(outsideFile, path.join(mocks.appPath, "Escape.tsx"));

    try {
      const handler = mocks.handlers.get(
        visualEditingContracts.applyChanges.channel,
      );
      await expect(
        handler!(
          {},
          {
            appId: 1,
            changes: [
              {
                componentId: "Escape.tsx:1:1",
                componentName: "div",
                relativePath: "Escape.tsx",
                lineNumber: 1,
                styles: { margin: { left: "8px" } },
              },
            ],
          },
        ),
      ).rejects.toThrow("outside the app");

      await expect(fs.readFile(outsideFile, "utf-8")).resolves.toBe("outside");
      expect(mocks.gitAdd).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
