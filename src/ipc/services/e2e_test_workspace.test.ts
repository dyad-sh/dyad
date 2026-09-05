import { promises as fs } from "node:fs";
import { execFile, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({ getUserDataPath: vi.fn() }));
vi.mock("@/ipc/utils/process_manager", () => ({
  forceKillProcessTree: vi.fn(async () => true),
}));
vi.mock("@/ipc/services/isolated_package_install", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/ipc/services/isolated_package_install")
    >();
  return {
    ...actual,
    resolvePackageManager: vi.fn(),
    runCleanPackageInstall: vi.fn(),
  };
});

import { getUserDataPath } from "@/paths/paths";
import {
  resolvePackageManager,
  runCleanPackageInstall,
} from "@/ipc/services/isolated_package_install";
import { trackedE2eTestProcessCount } from "@/ipc/services/e2e_test_process_registry";
import { forceKillProcessTree } from "@/ipc/utils/process_manager";
import {
  createE2eTestWorkspace as createWorkspaceUnderTest,
  E2E_TEST_ARTIFACT_DIR,
  E2E_TEST_SANDBOX_DIR,
  installE2eTestWorkspaceDependencies,
  reconcileOrphanE2eTestWorkspaces,
  removeE2eTestArtifactsForApp,
  retainE2eTestArtifacts,
  rewriteE2eArtifactPath,
} from "./e2e_test_workspace";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

beforeEach(() => {
  vi.mocked(resolvePackageManager).mockImplementation(async (appPath) => ({
    packageManager: "npm",
    sourceInstallPath: appPath,
  }));
  vi.mocked(runCleanPackageInstall).mockImplementation(async ({ cwd }) => {
    await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
    return {
      code: 0,
      stdout: "installed",
      stderr: "",
      aborted: false,
      timedOut: false,
      hasLockfile: false,
    };
  });
});

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-e2e-workspace-"));
  roots.push(root);
  return root;
}

async function ensureGitRepo(appPath: string): Promise<void> {
  const hasGit = await fs
    .stat(path.join(appPath, ".git"))
    .then(() => true)
    .catch(() => false);
  if (hasGit) return;
  await fs.mkdir(appPath, { recursive: true });
  const packageJsonPath = path.join(appPath, "package.json");
  await fs
    .stat(packageJsonPath)
    .catch(() => fs.writeFile(packageJsonPath, '{"private":true}\n'));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: appPath,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: appPath,
  });
  await execFileAsync("git", ["add", "-A"], { cwd: appPath });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: appPath });
}

async function createE2eTestWorkspace(
  options: Parameters<typeof createWorkspaceUnderTest>[0],
) {
  await ensureGitRepo(options.appPath);
  return createWorkspaceUnderTest(options);
}

describe("E2E test workspace", () => {
  it("captures live Git state while excluding heavyweight roots", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, ".gitignore"),
      ".env.local\nnode_modules\ndist\n",
    );
    await fs.writeFile(path.join(appPath, "src", "tracked.ts"), "before");
    await fs.writeFile(path.join(appPath, "src", "deleted.ts"), "delete me");
    await ensureGitRepo(appPath);
    await fs.writeFile(path.join(appPath, "src", "tracked.ts"), "after");
    await fs.rm(path.join(appPath, "src", "deleted.ts"));
    await fs.mkdir(path.join(appPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.writeFile(path.join(appPath, "src", "new.ts"), "uncommitted");
    await fs.writeFile(path.join(appPath, ".env.local"), "REAL=1\n");
    await fs.writeFile(path.join(appPath, "node_modules", "pkg", "x"), "x");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, "src", "new.ts"),
        "utf8",
      ),
    ).toBe("uncommitted");
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, "src", "tracked.ts"),
        "utf8",
      ),
    ).toBe("after");
    await expect(
      fs.stat(path.join(workspace.workspacePath, "src", "deleted.ts")),
    ).rejects.toThrow();
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, ".env.local"),
        "utf8",
      ),
    ).toBe("REAL=1\n");
    await fs.writeFile(
      path.join(workspace.workspacePath, "src", "new.ts"),
      "sandbox-only",
    );
    expect(await fs.readFile(path.join(appPath, "src", "new.ts"), "utf8")).toBe(
      "uncommitted",
    );
    await expect(
      fs.stat(path.join(workspace.workspacePath, "node_modules", "pkg", "x")),
    ).rejects.toThrow();
    expect(
      (
        await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
          cwd: workspace.workspacePath,
        })
      ).stdout.trim(),
    ).toBe(await fs.realpath(workspace.workspacePath));

    await workspace.dispose();
    await expect(fs.stat(workspace.workspacePath)).rejects.toThrow();
  });

  it("carries live edits into a tracked build-output root", async () => {
    // `dist` is normally disposable, but committed `dist` content is a build
    // *input*. The worktree keeps its checked-out copy — and the overlay has to
    // put the working-tree version over it, or the sandbox silently tests
    // whatever was last committed.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "dist"), { recursive: true });
    await fs.writeFile(path.join(appPath, "dist", "vendor.js"), "committed");
    await ensureGitRepo(appPath);
    await fs.writeFile(path.join(appPath, "dist", "vendor.js"), "edited");
    await fs.writeFile(path.join(appPath, "dist", "extra.js"), "untracked");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, "dist", "vendor.js"),
        "utf8",
      ),
    ).toBe("edited");
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, "dist", "extra.js"),
        "utf8",
      ),
    ).toBe("untracked");
    await workspace.dispose();
  });

  it("drops an untracked build-output root entirely", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, ".gitignore"), "dist\n");
    await ensureGitRepo(appPath);
    await fs.mkdir(path.join(appPath, "dist"), { recursive: true });
    await fs.writeFile(path.join(appPath, "dist", "bundle.js"), "stale");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await expect(
      fs.stat(path.join(workspace.workspacePath, "dist")),
    ).rejects.toThrow();
    await workspace.dispose();
  });

  it("removes a committed node_modules despite it being tracked", async () => {
    // The one excluded root that is never preserved: the sandbox installs a
    // clean dependency tree, so a committed one would be exactly the live
    // dependency state this isolation exists to leave behind.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "node_modules", "pkg", "index.js"),
      "committed",
    );
    await ensureGitRepo(appPath);

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await expect(
      fs.stat(path.join(workspace.workspacePath, "node_modules")),
    ).rejects.toThrow();
    await workspace.dispose();
  });

  it("removes a tracked node_modules above a nested app too", async () => {
    // A monorepo app installs at its workspace root, so a committed
    // `node_modules` at the repository root sits above the app directory — and
    // above the sweep that clears the app's own excluded roots — right where
    // Node's upward resolution finds it.
    const root = await tempRoot();
    const repoRoot = path.join(root, "repo");
    const appPath = path.join(repoRoot, "packages", "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(repoRoot, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, "node_modules", "pkg", "index.js"),
      "committed",
    );
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");
    await ensureGitRepo(repoRoot);

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    // `workspacePath` is the app inside the worktree; the repository root is
    // two levels up.
    const worktreeRoot = path.resolve(workspace.workspacePath, "..", "..");
    await expect(
      fs.stat(path.join(worktreeRoot, "node_modules")),
    ).rejects.toThrow();
    await workspace.dispose();
  });

  it("withholds database credentials from install scripts, then restores them", async () => {
    // `--ignore-scripts` would also break `prisma generate` and native
    // rebuilds; taking the database out of the environment leaves the scripts
    // running and denies them only what they must not reach.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");
    await ensureGitRepo(appPath);
    const env =
      "# keep me\nDATABASE_URL=postgres://real\nNEXT_PUBLIC_SUPABASE_URL=https://real\nAPI_BASE=https://example.test\n";
    await fs.writeFile(path.join(appPath, ".env.local"), env);

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    let duringInstall = "";
    vi.mocked(runCleanPackageInstall).mockImplementationOnce(async () => {
      duringInstall = await fs.readFile(
        path.join(workspace.workspacePath, ".env.local"),
        "utf8",
      );
      return {
        code: 0,
        stdout: "",
        stderr: "",
        aborted: false,
        timedOut: false,
        hasLockfile: false,
      };
    });

    await installE2eTestWorkspaceDependencies({
      workspace,
      withholdDatabaseEnv: true,
    });

    expect(duringInstall).not.toContain("DATABASE_URL");
    expect(duringInstall).not.toContain("SUPABASE");
    // Only the database reaches for the door; everything else the scripts may
    // legitimately need stays.
    expect(duringInstall).toContain("API_BASE=https://example.test");
    expect(duringInstall).toContain("# keep me");
    // And the run itself gets the real thing back.
    expect(
      await fs.readFile(
        path.join(workspace.workspacePath, ".env.local"),
        "utf8",
      ),
    ).toBe(env);
    await workspace.dispose();
  });

  it("removes a tracked virtualenv anywhere in the repository", async () => {
    // A monorepo sibling's `.venv` records absolute paths in `pyvenv.cfg` and
    // its shebangs, so a copy activates an interpreter pointing back at the
    // live checkout — the sandbox escaping itself.
    const root = await tempRoot();
    const repoRoot = path.join(root, "repo");
    const appPath = path.join(repoRoot, "packages", "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(repoRoot, "packages", "api", ".venv", "bin"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, "packages", "api", ".venv", "pyvenv.cfg"),
      `home = ${repoRoot}\n`,
    );
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");
    await ensureGitRepo(repoRoot);

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    const worktreeRoot = path.resolve(workspace.workspacePath, "..", "..");
    await expect(
      fs.stat(path.join(worktreeRoot, "packages", "api", ".venv")),
    ).rejects.toThrow();
    await workspace.dispose();
  });

  it("removes a tracked node_modules at an intermediate depth", async () => {
    // Node resolves up through every ancestor, so a committed
    // `/repo/packages/node_modules` would satisfy an import the clean install
    // never provided.
    const root = await tempRoot();
    const repoRoot = path.join(root, "repo");
    const appPath = path.join(repoRoot, "packages", "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(repoRoot, "packages", "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, "packages", "node_modules", "pkg", "index.js"),
      "committed",
    );
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");
    await ensureGitRepo(repoRoot);

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    const worktreeRoot = path.resolve(workspace.workspacePath, "..", "..");
    await expect(
      fs.stat(path.join(worktreeRoot, "packages", "node_modules")),
    ).rejects.toThrow();
    await workspace.dispose();
  });

  it("classifies an isolated dependency install failure without touching the live app", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");

    vi.mocked(runCleanPackageInstall).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "lockfile mismatch",
      aborted: false,
      timedOut: false,
      hasLockfile: true,
    });
    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await expect(
      installE2eTestWorkspaceDependencies({ workspace }),
    ).rejects.toThrow(/lockfile mismatch/i);
    expect(vi.mocked(runCleanPackageInstall).mock.calls.at(-1)?.[0].cwd).toBe(
      workspace.workspacePath,
    );
    await workspace.dispose();
    const remaining = await fs.readdir(
      path.join(root, "user-data", E2E_TEST_SANDBOX_DIR),
    );
    expect(remaining.filter((entry) => entry.startsWith("7-"))).toEqual([]);
  });

  it("allows a custom-command app to have no node_modules at all", async () => {
    // Custom install/start commands need not describe a Node project, and the
    // install command runs inside the sandbox. Refusing here would make the
    // sandbox structurally impossible for every such app — while the Run
    // button stays enabled, because the dev-server gate is gone.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "main.py"), "print('hi')\n");

    vi.mocked(runCleanPackageInstall).mockClear();
    const workspace = await createE2eTestWorkspace({
      appId: 7,
      appPath,
      hasCustomCommands: true,
    });
    expect(
      await fs.readFile(path.join(workspace.workspacePath, "main.py"), "utf8"),
    ).toBe("print('hi')\n");
    expect(runCleanPackageInstall).not.toHaveBeenCalled();
    await installE2eTestWorkspaceDependencies({ workspace });
    expect(runCleanPackageInstall).not.toHaveBeenCalled();
    await workspace.dispose();
  });

  it("keeps artifact rewriting working when user data sits behind a symlink", async () => {
    // Playwright resolves its artifact paths against the runner's cwd, which
    // the OS reports symlink-resolved. If the workspace root kept an
    // unresolved ancestor (`/var` -> `/private/var`, which is what os.tmpdir()
    // and so DYAD_DEV_USER_DATA_DIR give on macOS), `path.relative` would
    // answer `../..` and every failure would silently lose its screenshot.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const realUserData = path.join(root, "real-user-data");
    const linkedUserData = path.join(root, "linked-user-data");
    await fs.mkdir(realUserData, { recursive: true });
    await fs.symlink(realUserData, linkedUserData, "dir");
    vi.mocked(getUserDataPath).mockReturnValue(linkedUserData);
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "index.js"), "console.log(1)\n");

    const workspace = await createE2eTestWorkspace({ appId: 11, appPath });
    // The root is handed out already resolved, so it compares equal to what
    // Playwright reports.
    expect(await fs.realpath(workspace.workspacePath)).toBe(
      workspace.workspacePath,
    );

    const reported = path.join(
      await fs.realpath(workspace.workspacePath),
      "test-results",
      "spec-chromium",
      "shot.png",
    );
    expect(
      rewriteE2eArtifactPath(
        reported,
        workspace.workspacePath,
        workspace.artifactPath,
      ),
    ).toBe(
      path.join(
        workspace.artifactPath,
        "test-results",
        "spec-chromium",
        "shot.png",
      ),
    );
    await workspace.dispose();
  });

  it("drops artifact paths when retention didn't happen", () => {
    // Retention is best-effort: when the copy out of the sandbox fails, the
    // result keeps its verdicts but must not point at a directory that is
    // about to be deleted.
    expect(
      rewriteE2eArtifactPath(
        path.join("/ws", "test-results", "shot.png"),
        "/ws",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("retains and rewrites screenshot artifacts before disposal", async () => {
    const root = await tempRoot();
    const workspacePath = path.join(root, "workspace");
    const artifactPath = path.join(root, "artifacts");
    const screenshot = path.join(workspacePath, "test-results", "shot.png");
    await fs.mkdir(path.dirname(screenshot), { recursive: true });
    await fs.writeFile(screenshot, "png");

    await retainE2eTestArtifacts({ workspacePath, artifactPath });
    expect(
      rewriteE2eArtifactPath(screenshot, workspacePath, artifactPath),
    ).toBe(path.join(artifactPath, "test-results", "shot.png"));
    expect(
      await fs.readFile(
        path.join(artifactPath, "test-results", "shot.png"),
        "utf8",
      ),
    ).toBe("png");
  });

  it("keeps the last run's artifacts when a new run never produces any", async () => {
    // Pruning used to happen when the workspace was created. A run that then
    // failed during setup left the panel showing the previous run's results
    // with every screenshot path pointing at a directory that had just been
    // deleted — thumbnails that silently stop loading.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    const previous = path.join(userData, E2E_TEST_ARTIFACT_DIR, "7-oldrun");
    await fs.mkdir(path.join(previous, "test-results"), { recursive: true });
    await fs.writeFile(path.join(previous, "test-results", "shot.png"), "png");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    expect(
      await fs.readFile(
        path.join(previous, "test-results", "shot.png"),
        "utf8",
      ),
    ).toBe("png");
    await workspace.dispose();
  });

  it("drops the previous run's artifacts once this run has replacements", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    const previous = path.join(userData, E2E_TEST_ARTIFACT_DIR, "7-oldrun");
    await fs.mkdir(previous, { recursive: true });
    const other = path.join(userData, E2E_TEST_ARTIFACT_DIR, "8-otherapp");
    await fs.mkdir(other, { recursive: true });

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await fs.mkdir(path.join(workspace.workspacePath, "test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace.workspacePath, "test-results", "shot.png"),
      "png",
    );
    await retainE2eTestArtifacts(workspace);

    const remaining = await fs.readdir(
      path.join(userData, E2E_TEST_ARTIFACT_DIR),
    );
    expect(remaining).not.toContain("7-oldrun");
    // Another app's artifacts are none of this run's business.
    expect(remaining).toContain("8-otherapp");
    expect(remaining).toContain(path.basename(workspace.artifactPath));
    await workspace.dispose();
  });

  it("registers the dependency install so quit can tree-kill it", async () => {
    // `will-quit` cannot await the async abort path, so aborting the run alone
    // would leave a cold `npm ci` (budgeted at 15 minutes) alive past the quit,
    // still holding the sandbox directory as its cwd — the state that makes the
    // next launch's orphan sweep fail on Windows. The sandbox server and the
    // Playwright runner already register; the install has to as well.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });

    let installChild: ChildProcess | undefined;
    vi.mocked(runCleanPackageInstall).mockImplementationOnce(
      async ({ cwd, onProcess }) => {
        await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
        installChild = new EventEmitter() as unknown as ChildProcess;
        // `spawnStreaming` only resolves once the process has closed, so an
        // install that returns normally has always exited. (The abnormal
        // Stop/timeout path, where it has not, is covered below.)
        Object.assign(installChild, {
          pid: 4242,
          exitCode: 0,
          signalCode: null,
        });
        onProcess?.(installChild);
        return {
          code: 0,
          stdout: "",
          stderr: "",
          aborted: false,
          timedOut: false,
          hasLockfile: false,
        };
      },
    );

    const before = trackedE2eTestProcessCount();
    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await installE2eTestWorkspaceDependencies({ workspace });

    expect(installChild).toBeDefined();
    expect(trackedE2eTestProcessCount()).toBe(before + 1);
    // The registry drops it again on its own exit, so a finished install can't
    // sit there for the life of the process.
    installChild!.emit("exit", 0, null);
    expect(trackedE2eTestProcessCount()).toBe(before);
    await workspace.dispose();
  });

  it("waits for a killed install tree before restoring the credentials", async () => {
    // On a Stop or a timeout `spawnStreaming` fires `treeKill` and returns
    // without waiting, so the install tree can outlive the call. Restoring the
    // real credentials — or deleting the workspace — while a lifecycle script
    // is still running in it is the failure this barrier exists to prevent.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, ".env.local"),
      "DATABASE_URL=postgres://real/db\nPUBLIC_KEY=keep\n",
    );

    let withheldAtSettle = false;
    let survivor: ChildProcess | undefined;
    vi.mocked(runCleanPackageInstall).mockImplementationOnce(
      async ({ cwd, onProcess }) => {
        await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
        survivor = new EventEmitter() as unknown as ChildProcess;
        Object.assign(survivor, { pid: 909, exitCode: null, signalCode: null });
        onProcess?.(survivor);
        return {
          code: 1,
          stdout: "",
          stderr: "",
          aborted: true,
          timedOut: false,
          hasLockfile: false,
        };
      },
    );

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    vi.mocked(forceKillProcessTree).mockImplementationOnce(async (child) => {
      withheldAtSettle = !(
        await fs.readFile(
          path.join(workspace.workspacePath, ".env.local"),
          "utf8",
        )
      ).includes("DATABASE_URL");
      Object.assign(child, { exitCode: null, signalCode: "SIGKILL" });
      return true;
    });

    await expect(
      installE2eTestWorkspaceDependencies({
        workspace,
        withholdDatabaseEnv: true,
      }),
    ).rejects.toThrow("Test run stopped.");

    expect(survivor).toBeDefined();
    expect(vi.mocked(forceKillProcessTree)).toHaveBeenCalledWith(survivor);
    // The credentials were still withheld when the tree was settled, not
    // already handed back to a script that had not stopped.
    expect(withheldAtSettle).toBe(true);
    await workspace.dispose();
  });

  it("keeps the previous run's artifacts when retention produces nothing", async () => {
    // The prune used to run from a `finally`, so a run that wrote no
    // `test-results` at all still deleted the directory it had nothing to
    // replace — and the panel keeps prior rows across a file run (siblings) or
    // a single-test/grep run (everything), so those rows lost their
    // screenshots with nothing logged.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    const previous = path.join(userData, E2E_TEST_ARTIFACT_DIR, "7-oldrun");
    await fs.mkdir(path.join(previous, "test-results"), { recursive: true });
    await fs.writeFile(path.join(previous, "test-results", "shot.png"), "png");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    // No `test-results` in the sandbox: nothing for this run to retain.
    await retainE2eTestArtifacts(workspace);

    expect(
      await fs.readFile(
        path.join(previous, "test-results", "shot.png"),
        "utf8",
      ),
    ).toBe("png");
    await workspace.dispose();
  });

  it("does not delete a concurrent run's artifacts", async () => {
    // A second Run for the same app aborts the first and proceeds without
    // awaiting its teardown, so both cleanups overlap. Whichever retained
    // second would otherwise delete the other's screenshots before they ever
    // reached the panel.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });

    const first = await createE2eTestWorkspace({ appId: 7, appPath });
    const second = await createE2eTestWorkspace({ appId: 7, appPath });
    await fs.mkdir(path.join(first.artifactPath, "test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(first.artifactPath, "test-results", "shot.png"),
      "png",
    );
    // The second run finishes its retention while the first is still live.
    await fs.mkdir(path.join(second.workspacePath, "test-results"), {
      recursive: true,
    });
    await retainE2eTestArtifacts(second);

    expect(
      await fs.readFile(
        path.join(first.artifactPath, "test-results", "shot.png"),
        "utf8",
      ),
    ).toBe("png");
    await first.dispose();
    await second.dispose();
  });

  it("keeps earlier artifacts a partial run's surviving rows still point at", async () => {
    // A file-only, single-test or grep run leaves the untargeted files' results
    // on screen, and their screenshots live in earlier runs' directories.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    const previous = path.join(userData, E2E_TEST_ARTIFACT_DIR, "7-oldrun");
    await fs.mkdir(path.join(previous, "test-results"), { recursive: true });
    await fs.writeFile(path.join(previous, "test-results", "shot.png"), "png");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await fs.mkdir(path.join(workspace.workspacePath, "test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace.workspacePath, "test-results", "new.png"),
      "png",
    );
    await retainE2eTestArtifacts(workspace, { replacesEveryResult: false });

    expect(
      await fs.readFile(
        path.join(previous, "test-results", "shot.png"),
        "utf8",
      ),
    ).toBe("png");
    await workspace.dispose();
  });

  it("propagates a retention failure rather than reporting a copy it never made", async () => {
    // A stat that fails for any reason but "it isn't there" must not read as
    // "nothing to retain": the caller then rewrites every screenshot path into
    // an artifact directory that was never written.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    const stat = vi
      .spyOn(fs, "stat")
      .mockRejectedValueOnce(
        Object.assign(new Error("permission denied"), { code: "EACCES" }),
      );
    try {
      await expect(retainE2eTestArtifacts(workspace)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      stat.mockRestore();
      await workspace.dispose();
    }
  });

  it("keeps the run it replaced, and drops its own leftovers, when the copy fails", async () => {
    // The caller drops THIS run's paths on a failed copy, which leaves the
    // previous run's directory as the only thing the panel's surviving rows
    // still point at — so it has to stay. Only this run's half-written
    // directory goes, so a copy that keeps failing can't leave one per run.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    const previous = path.join(userData, E2E_TEST_ARTIFACT_DIR, "7-oldrun");
    await fs.mkdir(path.join(previous, "test-results"), { recursive: true });
    await fs.writeFile(path.join(previous, "test-results", "shot.png"), "png");

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    await fs.mkdir(path.join(workspace.workspacePath, "test-results"), {
      recursive: true,
    });
    // The copy is failed directly, the way a real EBUSY/ENOSPC would. Making
    // the source unreadable with `chmod(0o000)` instead is not a failure at
    // all when the suite runs as root (CI containers) or on Windows, so the
    // `rejects` assertion would pass vacuously — or fail outright.
    const cp = vi
      .spyOn(fs, "cp")
      .mockRejectedValueOnce(
        Object.assign(new Error("copy failed"), { code: "ENOSPC" }),
      );

    try {
      await expect(retainE2eTestArtifacts(workspace)).rejects.toThrow(
        /copy failed/,
      );
      const remaining = await fs.readdir(
        path.join(userData, E2E_TEST_ARTIFACT_DIR),
      );
      expect(remaining).toContain("7-oldrun");
      expect(remaining).not.toContain(path.basename(workspace.artifactPath));
      expect(
        await fs.readFile(
          path.join(previous, "test-results", "shot.png"),
          "utf8",
        ),
      ).toBe("png");
    } finally {
      cp.mockRestore();
      await workspace.dispose();
    }
  });

  it("keeps run directory names short enough for Windows MAX_PATH", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    const runName = path.basename(workspace.workspacePath);
    // mkdtemp contributes only six random characters beneath the already-deep
    // user-data root, keeping pnpm paths within Windows MAX_PATH.
    expect(runName).toMatch(/^7-[A-Za-z0-9]{6}$/);
    await workspace.dispose();
  });

  it("sweeps abandoned sandboxes without touching a live run", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(appPath, "app.ts"), "app");

    const live = await createE2eTestWorkspace({ appId: 9, appPath });
    const sandboxRoot = path.join(userData, E2E_TEST_SANDBOX_DIR);
    const orphan = path.join(sandboxRoot, "9-orphan");
    const unmarked = path.join(sandboxRoot, "9-unmarked");
    const realAppPath = await fs.realpath(appPath);
    // A real registration, not just a directory: the Git metadata is what makes
    // an abandoned sandbox break later runs (`git worktree add` refuses a path
    // it still knows about), so a sweep that removed the files and left the
    // registration would pass a directories-only assertion while fixing nothing.
    await execFileAsync(
      "git",
      ["worktree", "add", "--detach", orphan, "HEAD"],
      {
        cwd: realAppPath,
      },
    );
    await fs.mkdir(unmarked, { recursive: true });
    await fs.writeFile(
      `${orphan}.owner.json`,
      JSON.stringify({
        schema: "dyad-git-overlay-worktree-v1",
        purpose: "e2e-test",
        sourceRepoPath: realAppPath,
        submoduleWorktrees: [],
      }),
    );
    expect(
      (await execFileAsync("git", ["worktree", "list"], { cwd: realAppPath }))
        .stdout,
    ).toContain(orphan);

    await reconcileOrphanE2eTestWorkspaces();

    await expect(fs.stat(orphan)).rejects.toThrow();
    expect(
      (await execFileAsync("git", ["worktree", "list"], { cwd: realAppPath }))
        .stdout,
    ).not.toContain(orphan);
    await expect(fs.stat(`${orphan}.owner.json`)).rejects.toThrow();
    expect((await fs.stat(unmarked)).isDirectory()).toBe(true);
    expect(
      await fs.readFile(path.join(live.workspacePath, "app.ts"), "utf8"),
    ).toBe("app");

    await live.dispose();
    await reconcileOrphanE2eTestWorkspaces();
    await expect(fs.stat(live.workspacePath)).rejects.toThrow();
  });

  it("prunes artifacts for apps that no longer exist", async () => {
    // Nothing else ever removes these: they're replaced only by the next run
    // of the same app, which never comes once the app is deleted.
    const root = await tempRoot();
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const artifactRoot = path.join(userData, E2E_TEST_ARTIFACT_DIR);
    const kept = path.join(artifactRoot, "3-1-kept");
    const orphaned = path.join(artifactRoot, "9-1-orphaned");
    const unparseable = path.join(artifactRoot, "not-a-run");
    for (const dir of [kept, orphaned, unparseable]) {
      await fs.mkdir(dir, { recursive: true });
    }

    await reconcileOrphanE2eTestWorkspaces({
      refreshKnownAppIds: async () => new Set([3]),
    });

    expect((await fs.stat(kept)).isDirectory()).toBe(true);
    await expect(fs.stat(orphaned)).rejects.toThrow();
    // Not ours to interpret, so it is left alone rather than guessed at.
    expect((await fs.stat(unparseable)).isDirectory()).toBe(true);
  });

  it("leaves artifacts alone when the caller can't say which apps exist", async () => {
    const root = await tempRoot();
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const artifact = path.join(userData, E2E_TEST_ARTIFACT_DIR, "9-1-run");
    await fs.mkdir(artifact, { recursive: true });

    await reconcileOrphanE2eTestWorkspaces();

    expect((await fs.stat(artifact)).isDirectory()).toBe(true);
  });

  it("drops one app's artifacts without touching another's", async () => {
    const root = await tempRoot();
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const artifactRoot = path.join(userData, E2E_TEST_ARTIFACT_DIR);
    const deleted = path.join(artifactRoot, "9-1-run");
    const other = path.join(artifactRoot, "10-1-run");
    for (const dir of [deleted, other]) {
      await fs.mkdir(dir, { recursive: true });
    }

    await removeE2eTestArtifactsForApp(9);

    await expect(fs.stat(deleted)).rejects.toThrow();
    // A prefix match, not a substring match: "10-" must survive removing 9.
    expect((await fs.stat(other)).isDirectory()).toBe(true);
  });

  it("leaves a file alone even when its name looks like a run directory", async () => {
    // Both sweeps remove run *directories*. A regular file that happens to
    // match the shape is not one of ours to delete.
    const root = await tempRoot();
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const artifactRoot = path.join(userData, E2E_TEST_ARTIFACT_DIR);
    await fs.mkdir(artifactRoot, { recursive: true });
    const file = path.join(artifactRoot, "9-notes.txt");
    const directory = path.join(artifactRoot, "9-abc123");
    await fs.writeFile(file, "notes");
    await fs.mkdir(directory, { recursive: true });

    await removeE2eTestArtifactsForApp(9);

    await expect(fs.stat(directory)).rejects.toThrow();
    expect((await fs.stat(file)).isFile()).toBe(true);
  });

  it("only claims entries shaped like one of its own run directories", async () => {
    // Run names are always `<appId>-<mkdtemp suffix>`. A bare `9`, or a `9-`
    // with nothing after it, is not something Dyad created here and not
    // something it may delete.
    const root = await tempRoot();
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const artifactRoot = path.join(userData, E2E_TEST_ARTIFACT_DIR);
    const bare = path.join(artifactRoot, "9");
    const emptySuffix = path.join(artifactRoot, "9-");
    const ours = path.join(artifactRoot, "9-abc123");
    for (const dir of [bare, emptySuffix, ours]) {
      await fs.mkdir(dir, { recursive: true });
    }

    await removeE2eTestArtifactsForApp(9);

    await expect(fs.stat(ours)).rejects.toThrow();
    expect((await fs.stat(bare)).isDirectory()).toBe(true);
    expect((await fs.stat(emptySuffix)).isDirectory()).toBe(true);
  });
});
