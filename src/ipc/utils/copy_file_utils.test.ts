import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCopyFile } from "./copy_file_utils";

const { deploySupabaseFunction, findApp, gitAdd, resolveAppPath } = vi.hoisted(
  () => ({
    deploySupabaseFunction: vi.fn(),
    findApp: vi.fn(),
    gitAdd: vi.fn(),
    resolveAppPath: vi.fn(),
  }),
);

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("./git_utils", () => ({ gitAdd }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: findApp } } },
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: resolveAppPath }));
vi.mock("../../supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunction,
}));

describe.runIf(process.platform !== "win32")(
  "executeCopyFile canonical mutation paths",
  () => {
    let appPath: string;

    beforeEach(async () => {
      appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-copy-app-"));
      await fs.mkdir(
        path.join(appPath, "supabase", "functions", "hello-world"),
        { recursive: true },
      );
      await fs.writeFile(path.join(appPath, "source.txt"), "copied");
      await fs.symlink(".", path.join(appPath, "self"), "dir");
      gitAdd.mockResolvedValue(undefined);
      deploySupabaseFunction.mockResolvedValue(undefined);
      findApp.mockResolvedValue({
        id: 987654,
        path: appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
      });
      resolveAppPath.mockImplementation((value: string) => value);
    });

    afterEach(async () => {
      await fs.rm(appPath, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    it("uses the physical path for writes, git, and Supabase classification", async () => {
      await executeCopyFile({
        from: "source.txt",
        to: "self/supabase/functions/hello-world/index.ts",
        appId: 987654,
      });

      await expect(
        fs.readFile(
          path.join(
            appPath,
            "supabase",
            "functions",
            "hello-world",
            "index.ts",
          ),
          "utf8",
        ),
      ).resolves.toBe("copied");
      expect(gitAdd).toHaveBeenCalledWith({
        path: appPath,
        filepath: "supabase/functions/hello-world/index.ts",
      });
      expect(deploySupabaseFunction).toHaveBeenCalledWith({
        appId: 987654,
        supabaseProjectId: "project-id",
        functionName: "hello-world",
        appPath,
        organizationSlug: null,
      });
    });

    it("still applies the copy after cancellation and leaves cancellation to the deploy", async () => {
      const abortController = new AbortController();
      abortController.abort();

      await executeCopyFile({
        from: "source.txt",
        to: "supabase/functions/hello-world/index.ts",
        appId: 987654,
        signal: abortController.signal,
      });

      await expect(
        fs.readFile(
          path.join(
            appPath,
            "supabase",
            "functions",
            "hello-world",
            "index.ts",
          ),
          "utf8",
        ),
      ).resolves.toBe("copied");
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({ signal: abortController.signal }),
      );
    });

    it("copies media from the app folder, or from the workspace when this turn made it", async () => {
      const workspacePath = await fs.mkdtemp(
        path.join(os.tmpdir(), "dyad-copy-workspace-"),
      );
      try {
        await fs.mkdir(path.join(appPath, ".dyad", "media"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(appPath, ".dyad", "media", "uploaded.png"),
          "uploaded",
        );
        await fs.mkdir(path.join(workspacePath, ".dyad", "media"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(workspacePath, ".dyad", "media", "generated.png"),
          "generated",
        );
        const workspace = {
          appPath: workspacePath,
          mediaAppPath: appPath,
          coordinationKey: 1_000_987_654,
        };

        await executeCopyFile({
          from: ".dyad/media/uploaded.png",
          to: "public/uploaded.png",
          appId: 987654,
          workspace,
        });
        await executeCopyFile({
          from: ".dyad/media/generated.png",
          to: "public/generated.png",
          appId: 987654,
          workspace,
        });
        await executeCopyFile({
          from: path.join(workspacePath, ".dyad", "media", "generated.png"),
          to: "public/generated-absolute.png",
          appId: 987654,
          workspace,
        });

        for (const [name, content] of [
          ["uploaded.png", "uploaded"],
          ["generated.png", "generated"],
          ["generated-absolute.png", "generated"],
        ]) {
          await expect(
            fs.readFile(path.join(workspacePath, "public", name), "utf8"),
          ).resolves.toBe(content);
        }
        await expect(
          fs.stat(path.join(appPath, "public")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(workspacePath, { recursive: true, force: true });
      }
    });
  },
);
