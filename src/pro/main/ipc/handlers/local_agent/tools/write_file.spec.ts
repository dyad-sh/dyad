import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { writeFileTool } from "./write_file";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual.default,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
  };
});

vi.mock("electron-log", () => ({
  default: { scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

describe("writeFileTool", () => {
  const context = { appId: 1, appPath: "/test/app" } as any;

  it("rejects writes to Git metadata", async () => {
    await expect(
      writeFileTool.execute(
        { path: ".git/config", content: "[core]\nhooksPath=hooks" },
        context,
      ),
    ).rejects.toThrow("cannot modify Git metadata");

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("allows normal .gitignore edits", async () => {
    await expect(
      writeFileTool.execute(
        { path: ".gitignore", content: "dist/\n" },
        context,
      ),
    ).resolves.toBe("Successfully wrote .gitignore");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/test/app/.gitignore",
      "dist/\n",
    );
  });
});
