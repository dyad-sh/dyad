// @vitest-environment node

import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import log from "electron-log";
import mainLog from "electron-log/main";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { execGit } from "@/ipc/utils/git_utils";
import { startE2eTestRuntime } from "./e2e_test_runtime";
import {
  createGitOverlayWorkspace,
  removeGitOverlayWorkspace,
  type GitOverlayWorkspace,
} from "./git_overlay_workspace";
import { runCleanPackageInstall } from "./isolated_package_install";

/**
 * Real Git, real links, real processes and a real `taskkill`. Nothing here is
 * mocked, because every bug this suite guards was invisible to a mock: each one
 * only exists in how Git for Windows and Windows itself actually behave.
 */

const isWindows = process.platform === "win32";

const roots: string[] = [];
const holders = new Set<ChildProcess>();
let warnings: string[] = [];

const captureWarnings: (typeof log.hooks)[number] = (message) => {
  if (message.level === "warn" || message.level === "error") {
    warnings.push(message.data.map(String).join(" "));
  }
  return message;
};

// The modules under test import both entry points.
for (const logger of new Set([log, mainLog])) {
  logger.hooks.push(captureWarnings);
}

beforeEach(() => {
  warnings = [];
});

afterEach(async () => {
  await Promise.all([...holders].map(stopHolder));
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      }),
    ),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execGit(args, cwd);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout;
}

async function initRepo(repoPath: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  await git(repoPath, "init", "-b", "main");
  await git(repoPath, "config", "user.name", "Test User");
  await git(repoPath, "config", "user.email", "test@example.com");
  await git(repoPath, "config", "core.autocrlf", "false");
  await fs.writeFile(path.join(repoPath, "app.ts"), "app\n");
  await git(repoPath, "add", "--all");
  await git(repoPath, "commit", "-m", "initial");
}

/**
 * A canonical root: `os.tmpdir()` can carry an 8.3 short name on Windows, which
 * Git resolves and these assertions must compare against.
 */
async function tempRoot(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "dyad-teardown-")),
  );
  roots.push(root);
  return root;
}

async function createWorkspace(
  root: string,
  sourceTargetPath: string,
): Promise<GitOverlayWorkspace> {
  return createGitOverlayWorkspace({
    sourceTargetPath,
    scratchRoot: path.join(root, "test-sandboxes"),
    directoryPrefix: "36-",
    purpose: "e2e-test",
    excludedTargetRootNames: new Set(),
  });
}

/**
 * The layout pnpm writes: `.pnpm/<package>/node_modules/<package>` is the real
 * directory, and each dependent links to it from its own `node_modules`. `a@1`
 * sorts first, so a walk in directory order deletes the target before it reaches
 * the link, which leaves the link dangling at the moment it is visited.
 */
async function writePnpmShapedInstall(packageRoot: string): Promise<void> {
  const pnpmRoot = path.join(packageRoot, "node_modules", ".pnpm");
  const target = path.join(pnpmRoot, "a@1", "node_modules", "a");
  const dependent = path.join(pnpmRoot, "b@1", "node_modules");
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(path.join(dependent, "b"), { recursive: true });
  await fs.writeFile(path.join(target, "index.js"), "module.exports = 'a';\n");
  await fs.writeFile(
    path.join(dependent, "b", "index.js"),
    "module.exports = 'b';\n",
  );
  await fs.symlink(target, path.join(dependent, "a"), "junction");
}

async function registeredWorktrees(repoPath: string): Promise<string[]> {
  const listing = await git(repoPath, "worktree", "list", "--porcelain");
  return listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

async function pathExists(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    () => true,
    () => false,
  );
}

async function holdDirectoryOpen(directory: string): Promise<ChildProcess> {
  // On Windows a process's cwd is an open handle on that directory, so this is
  // the same lock a surviving dev server or test runner would hold.
  const holder = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      cwd: directory,
      stdio: "ignore",
    },
  );
  holders.add(holder);
  await once(holder, "spawn");
  return holder;
}

async function stopHolder(holder: ChildProcess): Promise<void> {
  holders.delete(holder);
  if (holder.exitCode !== null || holder.signalCode !== null) return;
  const closed = once(holder, "close");
  holder.kill();
  await closed;
}

async function expectWorkspaceGone(
  workspace: GitOverlayWorkspace,
  repoPath = workspace.sourceRepoPath,
): Promise<void> {
  expect(await pathExists(workspace.worktreePath)).toBe(false);
  expect(await pathExists(`${workspace.worktreePath}.owner.json`)).toBe(false);
  expect(await registeredWorktrees(repoPath)).not.toContain(
    workspace.worktreePath,
  );
}

describe("removeGitOverlayWorkspace", () => {
  it("removes a pnpm install whose links dangle partway through the delete", async () => {
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const workspace = await createWorkspace(root, source);
    await writePnpmShapedInstall(workspace.targetPath);

    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(warnings).toEqual([]);
  }, 60_000);

  it("leaves the user's other stale worktree registrations alone", async () => {
    // Pruning is repository-wide. A worktree on a drive that is unplugged right
    // now looks stale and is not ours to forget.
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const usersWorktree = path.join(root, "external-drive-worktree");
    await git(source, "worktree", "add", "--detach", usersWorktree, "HEAD");
    await fs.rm(usersWorktree, { recursive: true, force: true });
    const workspace = await createWorkspace(root, source);
    await writePnpmShapedInstall(workspace.targetPath);

    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(await registeredWorktrees(source)).toContain(usersWorktree);
  }, 60_000);

  it("never follows a link out of the workspace", async () => {
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const workspace = await createWorkspace(root, source);
    const outside = path.join(root, "users-local-package");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "precious.txt"), "keep me");
    const nodeModules = path.join(workspace.targetPath, "node_modules");
    await fs.mkdir(nodeModules, { recursive: true });
    await fs.symlink(outside, path.join(nodeModules, "local-dep"), "junction");

    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(await fs.readFile(path.join(outside, "precious.txt"), "utf8")).toBe(
      "keep me",
    );
  }, 60_000);

  it("removes a submodule worktree that holds a pnpm install", async () => {
    // A submodule's registration lives in its own repository, and the workspace
    // is retained until that registration is withdrawn. Anything that cannot
    // delete this tree therefore strands the whole workspace on every launch.
    const root = await tempRoot();
    const library = path.join(root, "library");
    const app = path.join(root, "app");
    await initRepo(library);
    await initRepo(app);
    await git(
      app,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      library,
      "library",
    );
    await git(app, "commit", "-m", "add library");
    const submodulePath = path.join(app, "library");
    const workspace = await createWorkspace(root, app);
    const snapshot = path.join(workspace.worktreePath, "library");
    expect(await registeredWorktrees(submodulePath)).toContain(snapshot);
    await writePnpmShapedInstall(snapshot);

    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(await registeredWorktrees(submodulePath)).not.toContain(snapshot);
    expect(warnings).toEqual([]);
  }, 120_000);

  it("finishes a removal after an earlier attempt lost its registration", async () => {
    // What a previous version leaves behind: `git worktree remove` deletes the
    // registration even when it could not delete the tree.
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const workspace = await createWorkspace(root, source);
    await writePnpmShapedInstall(workspace.targetPath);
    const stranded = await execGit(
      ["worktree", "remove", "--force", workspace.worktreePath],
      source,
    );
    if (stranded.exitCode === 0) {
      // Only Git for Windows fails this removal, so recreate the state.
      await fs.mkdir(workspace.worktreePath, { recursive: true });
    }
    expect(await registeredWorktrees(source)).not.toContain(
      workspace.worktreePath,
    );

    await removeGitOverlayWorkspace(workspace.worktreePath);

    await expectWorkspaceGone(workspace);
    expect(warnings).toEqual([]);
  }, 60_000);

  it("withdraws a registration left locked by an interrupted setup", async () => {
    // `git worktree add` locks the entry while it initializes, so a Stop during
    // setup leaves it locked, and neither `prune` nor one `--force` removes that.
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const workspace = await createWorkspace(root, source);
    await git(source, "worktree", "lock", workspace.worktreePath);

    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(warnings).toEqual([]);
  }, 60_000);

  describe.runIf(isWindows)("with a real Windows lock", () => {
    it("waits out a lock that clears on its own", async () => {
      const root = await tempRoot();
      const source = path.join(root, "source");
      await initRepo(source);
      const workspace = await createWorkspace(root, source);
      await writePnpmShapedInstall(workspace.targetPath);
      const holder = await holdDirectoryOpen(workspace.targetPath);
      const release = setTimeout(() => void stopHolder(holder), 1_000);

      try {
        await removeGitOverlayWorkspace(
          workspace.worktreePath,
          workspace.sourceRepoPath,
        );
      } finally {
        clearTimeout(release);
      }

      await expectWorkspaceGone(workspace);
      expect(warnings).toEqual([]);
    }, 60_000);

    it("keeps everything a later sweep needs under a lock that does not clear", async () => {
      const root = await tempRoot();
      const source = path.join(root, "source");
      await initRepo(source);
      const workspace = await createWorkspace(root, source);
      await writePnpmShapedInstall(workspace.targetPath);
      const holder = await holdDirectoryOpen(workspace.targetPath);

      await removeGitOverlayWorkspace(
        workspace.worktreePath,
        workspace.sourceRepoPath,
      );

      // The startup sweep enumerates directories and reads the marker to find
      // the owning repository, so all three have to outlive this failure.
      expect(await pathExists(workspace.worktreePath)).toBe(true);
      expect(await pathExists(`${workspace.worktreePath}.owner.json`)).toBe(
        true,
      );
      expect(await registeredWorktrees(source)).toContain(
        workspace.worktreePath,
      );
      expect(warnings.join("\n")).toContain("Failed to remove workspace");

      await stopHolder(holder);
      // Called the way the startup sweep calls it: the marker alone names the
      // repository.
      await removeGitOverlayWorkspace(workspace.worktreePath);

      await expectWorkspaceGone(workspace);
    }, 60_000);
  });
});

describe("stopping a test server, then removing its workspace", () => {
  const noOpInstall = `"${process.execPath}" -e ""`;
  const serverSource = `import http from "node:http";
const port = Number(process.argv[2]);
http
  .createServer((_request, response) => response.end("sandbox"))
  .listen(port, "127.0.0.1");
`;

  it("stops cleanly, without signalling a root that already exited", async () => {
    const root = await tempRoot();
    const source = path.join(root, "source");
    await initRepo(source);
    const workspace = await createWorkspace(root, source);
    await fs.writeFile(
      path.join(workspace.targetPath, "server.mjs"),
      serverSource,
    );
    const runtime = await startE2eTestRuntime({
      workspacePath: workspace.targetPath,
      installCommand: noOpInstall,
      startCommand: `"${process.execPath}" server.mjs {port}`,
    });
    await expect(
      fetch(runtime.baseUrl).then((response) => response.text()),
    ).resolves.toBe("sandbox");

    await expect(runtime.stop()).resolves.toBe(true);
    await removeGitOverlayWorkspace(
      workspace.worktreePath,
      workspace.sourceRepoPath,
    );

    await expectWorkspaceGone(workspace);
    expect(warnings).toEqual([]);
  }, 60_000);

  it.runIf(isWindows)(
    "removes the executable a killed server's descendant was running from",
    async () => {
      // esbuild.exe and native addons are mapped from inside node_modules, and
      // a mapped image cannot be deleted until the process that holds it is
      // fully gone, which can trail the `close` event the stop is waiting for.
      const root = await tempRoot();
      const source = path.join(root, "source");
      await initRepo(source);
      const workspace = await createWorkspace(root, source);
      const binDir = path.join(workspace.targetPath, "node_modules", ".bin");
      await fs.mkdir(binDir, { recursive: true });
      const serviceExe = path.join(binDir, "native-service.exe");
      await fs.copyFile(
        path.join(process.env.SystemRoot!, "System32", "PING.EXE"),
        serviceExe,
      );
      await fs.writeFile(
        path.join(workspace.targetPath, "server.mjs"),
        `import { spawn } from "node:child_process";
spawn(${JSON.stringify(serviceExe)}, ["-n", "600", "127.0.0.1"], { stdio: "inherit" });
${serverSource}`,
      );
      const runtime = await startE2eTestRuntime({
        workspacePath: workspace.targetPath,
        installCommand: noOpInstall,
        startCommand: `"${process.execPath}" server.mjs {port}`,
      });

      await expect(runtime.stop()).resolves.toBe(true);
      await removeGitOverlayWorkspace(
        workspace.worktreePath,
        workspace.sourceRepoPath,
      );

      await expectWorkspaceGone(workspace);
      expect(warnings).toEqual([]);
    },
    60_000,
  );
});

/**
 * The full failure as a user hits it, with the real scaffold, a real pnpm
 * install and a real Vite server. It needs the network and takes minutes, so it
 * is opt-in: `DYAD_LIVE_TEARDOWN_TEST=1 npm test -- <this file>`.
 */
describe.runIf(process.env.DYAD_LIVE_TEARDOWN_TEST === "1")(
  "live pnpm and Vite teardown",
  () => {
    it("tears down a real installed run without a warning", async () => {
      const root = await tempRoot();
      const source = path.join(root, "source");
      await fs.cp(path.join(process.cwd(), "scaffold"), source, {
        recursive: true,
        filter: (entry) => !entry.includes("node_modules"),
      });
      await git(source, "init", "-b", "main");
      await git(source, "config", "user.name", "Test User");
      await git(source, "config", "user.email", "test@example.com");
      await git(source, "add", "--all");
      await git(source, "commit", "-m", "scaffold");
      const workspace = await createWorkspace(root, source);

      const install = await runCleanPackageInstall({
        cwd: workspace.targetPath,
        packageManager: "pnpm",
        timeoutMs: 8 * 60_000,
      });
      expect(install.code, install.stderr.slice(-2_000)).toBe(0);
      const runtime = await startE2eTestRuntime({
        workspacePath: workspace.targetPath,
        packageManager: "pnpm",
      });
      for (const url of ["/", "/src/main.tsx", "/@vite/client"]) {
        const response = await fetch(`${runtime.baseUrl}${url}`);
        await response.arrayBuffer();
      }

      await expect(runtime.stop()).resolves.toBe(true);
      await removeGitOverlayWorkspace(
        workspace.worktreePath,
        workspace.sourceRepoPath,
      );

      await expectWorkspaceGone(workspace);
      expect(warnings).toEqual([]);
    }, 600_000);
  },
);
