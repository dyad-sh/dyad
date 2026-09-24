import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "dugite";

const mocks = vi.hoisted(() => ({
  runtimeMode2: "docker" as "docker" | "host",
}));

vi.mock("@/main/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/settings")>();
  return {
    ...actual,
    readSettings: () => ({
      ...actual.readSettings(),
      runtimeMode2: mocks.runtimeMode2,
    }),
  };
});

import { GitService } from "./git_service";
import {
  isCommitMsgHookAvailable,
  isPreCommitHookAvailable,
  isPrepareCommitMsgHookAvailable,
  runPreCommitHook,
} from "./pre_commit_service";

const HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg"] as const;

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}

describe.skipIf(process.platform === "win32")(
  "commit hooks in Docker mode",
  () => {
    let repo: string;
    let markerDir: string;

    beforeEach(async () => {
      mocks.runtimeMode2 = "docker";
      repo = await mkdtemp(path.join(os.tmpdir(), "dyad-docker-hooks-"));
      markerDir = await mkdtemp(path.join(os.tmpdir(), "dyad-hook-markers-"));
      expect((await exec(["init"], repo)).exitCode).toBe(0);
      const hookDir = path.join(repo, ".git", "hooks");
      await mkdir(hookDir, { recursive: true });
      // Every hook leaves a marker on the host when it runs.
      for (const hook of HOOKS) {
        const hookPath = path.join(hookDir, hook);
        await writeFile(
          hookPath,
          `#!/bin/sh\ntouch "${path.join(markerDir, hook)}"\n`,
        );
        await chmod(hookPath, 0o755);
      }
      await writeFile(path.join(repo, "index.html"), "<h1>hi</h1>\n");
    });

    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
      await rm(markerDir, { recursive: true, force: true });
    });

    it("reports no hooks", async () => {
      expect(await isPreCommitHookAvailable(repo)).toBe(false);
      expect(await isPrepareCommitMsgHookAvailable(repo)).toBe(false);
      expect(await isCommitMsgHookAvailable(repo)).toBe(false);

      mocks.runtimeMode2 = "host";
      expect(await isPreCommitHookAvailable(repo)).toBe(true);
    });

    it("refuses to run a hook directly", async () => {
      await expect(runPreCommitHook({ path: repo })).rejects.toThrow(
        "Pre-commit hooks aren't supported in Docker mode",
      );
      expect(await exists(path.join(markerDir, "pre-commit"))).toBe(false);
    });

    it("commits without running any repository hook", async () => {
      const phases: string[] = [];

      const hash = await new GitService().stageAllAndCommitWithPreCommit({
        path: repo,
        message: "docker commit",
        onProgress: (phase) => phases.push(phase),
      });

      expect(hash).toMatch(/^[0-9a-f]{40}$/);
      const log = await exec(["log", "--format=%s"], repo);
      expect(log.stdout.trim()).toBe("docker commit");
      expect(phases).toEqual(["staging", "committing"]);
      for (const hook of HOOKS) {
        expect(await exists(path.join(markerDir, hook)), hook).toBe(false);
      }
    });

    it("still runs the hooks in Local mode", async () => {
      mocks.runtimeMode2 = "host";

      await new GitService().stageAllAndCommitWithPreCommit({
        path: repo,
        message: "local commit",
      });

      for (const hook of HOOKS) {
        expect(await exists(path.join(markerDir, hook)), hook).toBe(true);
      }
    });
  },
);
