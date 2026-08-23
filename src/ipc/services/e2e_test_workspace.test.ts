import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({ getUserDataPath: vi.fn() }));

import { getUserDataPath } from "@/paths/paths";
import {
  createE2eTestWorkspace,
  E2E_TEST_SANDBOX_DIR,
  reconcileOrphanE2eTestWorkspaces,
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
