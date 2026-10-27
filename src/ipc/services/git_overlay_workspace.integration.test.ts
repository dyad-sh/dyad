import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { execGit } from "@/ipc/utils/git_utils";
import {
  createGitOverlayWorkspace,
  removeGitOverlayWorkspace,
  type GitOverlayWorkspace,
} from "./git_overlay_workspace";

it.each(["e2e-test", "build"] as const)(
  "checks out, overlays, and removes long tracked paths for %s workspaces",
  async (purpose) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-long-path-"));
    const sourcePath = path.join(root, "source");
    // Even under a short temp root, the 180-character migration basenames
    // exceed Windows MAX_PATH once checked out beneath this sandbox root.
    const scratchRoot = path.join(root, "test-sandboxes-" + "x".repeat(80));
    const migrationPaths = ["0003", "0004"].map((version) =>
      path.join("supabase", "migrations", `${version}_${"m".repeat(171)}.sql`),
    );
    const git = async (...args: string[]) => {
      const result = await execGit(args, sourcePath);
      expect(result.exitCode, result.stderr).toBe(0);
      return result.stdout;
    };
    let workspace: GitOverlayWorkspace | undefined;
    try {
      await fs.mkdir(path.join(sourcePath, "supabase", "migrations"), {
        recursive: true,
      });
      await git("init", "-b", "main");
      await git("config", "user.name", "Test User");
      await git("config", "user.email", "test@example.com");
      await git("config", "core.autocrlf", "false");
      // Override any machine setting so Windows CI catches the regression.
      await git("config", "core.longpaths", "false");
      for (const migrationPath of migrationPaths) {
        await fs.writeFile(path.join(sourcePath, migrationPath), "select 1;\n");
      }
      await git("add", "--all");
      await git("commit", "-m", "Track long migration paths");
      const configBefore = await fs.readFile(
        path.join(sourcePath, ".git", "config"),
        "utf8",
      );
      await fs.writeFile(
        path.join(sourcePath, migrationPaths[1]),
        "select 2;\n",
      );

      workspace = await createGitOverlayWorkspace({
        sourceTargetPath: sourcePath,
        scratchRoot,
        directoryPrefix: "1-",
        purpose,
        excludedTargetRootNames: new Set(),
      });
      for (const [index, migrationPath] of migrationPaths.entries()) {
        const snapshotPath = path.join(workspace.targetPath, migrationPath);
        expect(path.basename(snapshotPath)).toHaveLength(180);
        expect(snapshotPath.length).toBeGreaterThan(260);
        expect(await fs.readFile(snapshotPath, "utf8")).toBe(
          `select ${index + 1};\n`,
        );
      }

      await removeGitOverlayWorkspace(
        workspace.worktreePath,
        workspace.sourceRepoPath,
      );
      await expect(fs.stat(workspace.worktreePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        fs.stat(`${workspace.worktreePath}.owner.json`),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const worktrees = await git("worktree", "list", "--porcelain");
      expect(worktrees.match(/^worktree /gm)).toHaveLength(1);
      expect(
        await fs.readFile(path.join(sourcePath, ".git", "config"), "utf8"),
      ).toBe(configBefore);
      expect(
        await fs.readFile(path.join(sourcePath, migrationPaths[1]), "utf8"),
      ).toBe("select 2;\n");
      workspace = undefined;
    } finally {
      if (workspace) {
        await removeGitOverlayWorkspace(
          workspace.worktreePath,
          workspace.sourceRepoPath,
        );
      }
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  },
  30_000,
);

it("deletes a workspace Git no longer recognizes without following links into the source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-stale-worktree-"));
  const sourcePath = path.join(root, "source");
  const scratchRoot = path.join(root, "build-snapshots");
  const git = async (...args: string[]) => {
    const result = await execGit(args, sourcePath);
    expect(result.exitCode, result.stderr).toBe(0);
    return result.stdout;
  };
  try {
    await fs.mkdir(path.join(sourcePath, "src"), { recursive: true });
    await git("init", "-b", "main");
    await git("config", "user.name", "Test User");
    await git("config", "user.email", "test@example.com");
    await fs.writeFile(path.join(sourcePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(sourcePath, "src", "index.ts"), "live\n");
    await git("add", "--all");
    await git("commit", "-m", "initial");
    const workspace = await createGitOverlayWorkspace({
      sourceTargetPath: sourcePath,
      scratchRoot,
      directoryPrefix: ".dyad-build-",
      purpose: "build",
      excludedTargetRootNames: new Set(),
    });
    // What an install leaves behind, including a link back into the live
    // checkout that the recursive delete must remove rather than follow.
    const installed = path.join(workspace.targetPath, "node_modules");
    await fs.mkdir(path.join(installed, "pkg"), { recursive: true });
    await fs.writeFile(path.join(installed, "pkg", "index.js"), "");
    await fs.symlink(
      sourcePath,
      path.join(installed, "live-source"),
      process.platform === "win32" ? "junction" : "dir",
    );
    // The state an earlier partial delete leaves: the worktree's `.git` file
    // is gone and a prune has dropped its registration.
    await fs.rm(path.join(workspace.worktreePath, ".git"), { force: true });
    await git("worktree", "prune");
    const refused = await execGit(
      ["worktree", "remove", "--force", workspace.worktreePath],
      sourcePath,
    );
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toMatch(/is not a working tree/);

    // No source path, like the stale sweep: it comes from the marker. A
    // second caller joins the removal already in flight.
    const removal = removeGitOverlayWorkspace(workspace.worktreePath);
    expect(removeGitOverlayWorkspace(workspace.worktreePath)).toBe(removal);
    await removal;

    await expect(fs.lstat(workspace.worktreePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.lstat(`${workspace.worktreePath}.owner.json`),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs.readFile(path.join(sourcePath, "src", "index.ts"), "utf8"),
    ).toBe("live\n");
    expect(
      (await git("worktree", "list", "--porcelain")).match(/^worktree /gm),
    ).toHaveLength(1);
    expect(await git("status", "--porcelain")).toBe("");
  } finally {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}, 30_000);
