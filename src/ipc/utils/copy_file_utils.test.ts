import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCopyFile } from "./copy_file_utils";

const { deploySupabaseFunction, gitAdd } = vi.hoisted(() => ({
  deploySupabaseFunction: vi.fn(),
  gitAdd: vi.fn(),
}));

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
        appPath,
        supabaseProjectId: "project-id",
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
        supabaseProjectId: "project-id",
        functionName: "hello-world",
        appPath,
        organizationSlug: null,
      });
    });
  },
);
