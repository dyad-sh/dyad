import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({ getUserDataPath: vi.fn() }));

import { getUserDataPath } from "@/paths/paths";
import {
  createE2eTestWorkspace,
  E2E_TEST_ARTIFACT_DIR,
  E2E_TEST_SANDBOX_DIR,
  reconcileOrphanE2eTestWorkspaces,
  removeE2eTestArtifactsForApp,
  retainE2eTestArtifacts,
  rewriteE2eArtifactPath,
  shouldCopyE2eWorkspacePath,
} from "./e2e_test_workspace";

const roots: string[] = [];

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

describe("E2E test workspace", () => {
  it("copies current source while excluding heavyweight roots", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.mkdir(path.join(appPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, ".git"), { recursive: true });
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
    const nodeModulesStat = await fs.lstat(
      path.join(workspace.workspacePath, "node_modules"),
    );
    expect(nodeModulesStat.isDirectory()).toBe(true);
    expect(nodeModulesStat.isSymbolicLink()).toBe(false);
    await expect(
      fs.stat(path.join(workspace.workspacePath, ".git")),
    ).rejects.toThrow();

    await workspace.dispose();
    await expect(fs.stat(workspace.workspacePath)).rejects.toThrow();
  });

  it.runIf(process.platform !== "win32")(
    "keeps pnpm dependency realpaths inside the sandbox",
    async () => {
      const root = await tempRoot();
      const appPath = path.join(root, "app");
      vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
      const packageStore = path.join(
        appPath,
        "node_modules",
        ".pnpm",
        "nitro@3",
        "node_modules",
        "nitro",
      );
      await fs.mkdir(packageStore, { recursive: true });
      await fs.writeFile(path.join(packageStore, "package.json"), "{}");
      await fs.symlink(
        path.join(".pnpm", "nitro@3", "node_modules", "nitro"),
        path.join(appPath, "node_modules", "nitro"),
        "dir",
      );

      const workspace = await createE2eTestWorkspace({ appId: 8, appPath });
      const sandboxNodeModules = path.join(
        workspace.workspacePath,
        "node_modules",
      );
      const nitroRealpath = await fs.realpath(
        path.join(sandboxNodeModules, "nitro"),
      );

      expect(path.relative(sandboxNodeModules, nitroRealpath)).not.toMatch(
        /^\.\./,
      );
      expect(nitroRealpath).not.toContain(path.join(appPath, "node_modules"));
    },
  );

  it("refuses a Dyad-managed app whose dependencies aren't installed", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(path.join(appPath, "package.json"), "{}");

    await expect(createE2eTestWorkspace({ appId: 7, appPath })).rejects.toThrow(
      /dependencies are not installed/i,
    );
    // The partial copy must not survive the refusal.
    await expect(
      fs.readdir(path.join(root, "user-data", E2E_TEST_SANDBOX_DIR)),
    ).resolves.toEqual([]);
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

    const workspace = await createE2eTestWorkspace({
      appId: 7,
      appPath,
      hasCustomCommands: true,
    });
    expect(
      await fs.readFile(path.join(workspace.workspacePath, "main.py"), "utf8"),
    ).toBe("print('hi')\n");
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

  it("keeps run directory names short enough for Windows MAX_PATH", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    await fs.mkdir(path.join(appPath, "node_modules"), { recursive: true });

    const workspace = await createE2eTestWorkspace({ appId: 7, appPath });
    const runName = path.basename(workspace.workspacePath);
    // `<appId>-<12 hex>`; a full epoch + UUID was ~50 characters of pure path
    // depth on top of a root already deeper than the app directory.
    expect(runName).toMatch(/^7-[0-9a-f]{12}$/);
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
    const orphan = path.join(sandboxRoot, "9-1-abandoned");
    await fs.mkdir(orphan, { recursive: true });

    await reconcileOrphanE2eTestWorkspaces();

    await expect(fs.stat(orphan)).rejects.toThrow();
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

    await reconcileOrphanE2eTestWorkspaces({ knownAppIds: new Set([3]) });

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

  it("uses a root-based exclusion policy", () => {
    const appPath = path.resolve("app");
    expect(
      shouldCopyE2eWorkspacePath(appPath, path.join(appPath, "src", "a.ts")),
    ).toBe(true);
    expect(
      shouldCopyE2eWorkspacePath(
        appPath,
        path.join(appPath, "node_modules", "x"),
      ),
    ).toBe(false);
    expect(
      shouldCopyE2eWorkspacePath(
        appPath,
        path.join(appPath, "test-results", "x"),
      ),
    ).toBe(false);
  });
});
