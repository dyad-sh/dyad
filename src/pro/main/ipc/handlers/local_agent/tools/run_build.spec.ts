import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runningApps } from "@/ipc/utils/process_manager";
import type { AgentContext } from "./types";

vi.mock("@/ipc/services/app_operation_coordinator", () => ({
  appOperationCoordinator: {
    run: vi.fn(async (_options: unknown, operation: () => Promise<unknown>) =>
      operation(),
    ),
  },
  readAppResource: vi.fn((resource: string) => ({ resource, mode: "read" })),
}));

import {
  accumulateBuildOutput,
  copySnapshotEntriesOnWindows,
  gatherBuildProjectFacts,
  getCleanInstallArgs,
  listSnapshotEntries,
  runBuildTool,
  removeStaleSnapshots,
  secureSnapshotSymlinks,
  selectBuildExecutionMode,
  type BuildProjectFacts,
} from "./run_build";

const safeViteFacts: BuildProjectFacts = {
  frameworkType: "vite",
  buildScript: "vite build",
  nextMajorVersion: null,
  previewRunning: true,
  nextDevOutputIsolated: false,
};

describe("run_build", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    runningApps.clear();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    );
  });

  it("defaults to allowed with an empty schema and generic lifecycle preview", () => {
    expect(runBuildTool.defaultConsent).toBe("always");
    expect(runBuildTool.modifiesState).toBe(true);
    expect(runBuildTool.inputSchema.parse({})).toEqual({});
    expect(runBuildTool.getConsentPreview?.({})).toBe(
      "Runs the app's current package.json build lifecycle (prebuild, build, and postbuild). An isolated build may install dependencies in a temporary workspace first. This executes project and dependency code with your user account. A workspace snapshot protects the live preview from ordinary build output, but is not a security sandbox.",
    );
  });

  it("uses reproducible clean-install commands for the selected package manager", () => {
    expect(
      getCleanInstallArgs({ packageManager: "pnpm", hasLockfile: true }),
    ).toEqual([
      "--config.pm-on-fail=ignore",
      "--config.confirmModulesPurge=false",
      "--config.strictDepBuilds=false",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
    ]);
    expect(
      getCleanInstallArgs({ packageManager: "npm", hasLockfile: true }),
    ).toEqual(["ci", "--legacy-peer-deps", "--prefer-offline"]);
    expect(
      getCleanInstallArgs({ packageManager: "npm", hasLockfile: false }),
    ).toEqual(["install", "--legacy-peer-deps", "--prefer-offline"]);
  });

  it("excludes live dependencies and generated output from clean snapshots", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-build-test-"),
    );
    temporaryDirectories.push(appPath);
    await Promise.all([
      fs.mkdir(path.join(appPath, "node_modules")),
      fs.mkdir(path.join(appPath, "dist")),
      fs.writeFile(path.join(appPath, "package.json"), "{}"),
      fs.writeFile(path.join(appPath, "pnpm-lock.yaml"), "lockfileVersion: 9"),
    ]);

    const entries = await listSnapshotEntries(appPath);
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining(["package.json", "pnpm-lock.yaml"]),
    );
  });

  it("accumulates streamed build output instead of replacing earlier chunks", () => {
    const first = accumulateBuildOutput("", "compiling...\n");
    const second = accumulateBuildOutput(first, "bundling...\n");

    expect(second).toBe("compiling...\nbundling...\n");
  });

  it("bounds concurrent filesystem work in the Windows snapshot copier", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "app");
    const snapshotRoot = path.join(root, "snapshot");
    await Promise.all([fs.mkdir(sourceRoot), fs.mkdir(snapshotRoot)]);
    const sourcePaths = await Promise.all(
      Array.from({ length: 65 }, async (_, index) => {
        const sourcePath = path.join(sourceRoot, `file-${index}.txt`);
        await fs.writeFile(sourcePath, String(index));
        return sourcePath;
      }),
    );

    const realLstat = fs.lstat.bind(fs);
    let active = 0;
    let maximumActive = 0;
    const lstat = vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await realLstat(...args);
      } finally {
        active -= 1;
      }
    });

    try {
      await copySnapshotEntriesOnWindows(
        sourceRoot,
        await fs.realpath(sourceRoot),
        snapshotRoot,
        sourcePaths,
      );
    } finally {
      lstat.mockRestore();
    }

    expect(maximumActive).toBe(32);
    await expect(
      fs.readFile(path.join(snapshotRoot, "file-64.txt"), "utf8"),
    ).resolves.toBe("64");
  });

  it("builds standard Vite in place beside a preview", () => {
    expect(selectBuildExecutionMode(safeViteFacts)).toBe("in-place");
    expect(
      selectBuildExecutionMode({
        ...safeViteFacts,
        buildScript: "tsc -b && vite build",
      }),
    ).toBe("isolated");
  });

  it("refreshes framework facts after a Vite app gains Nitro", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-build-test-"),
    );
    temporaryDirectories.push(appPath);
    await Promise.all([
      fs.writeFile(path.join(appPath, "vite.config.ts"), "export default {}"),
      fs.writeFile(path.join(appPath, "nitro.config.ts"), "export default {}"),
      fs.writeFile(
        path.join(appPath, "package.json"),
        JSON.stringify({
          devDependencies: { vite: "latest", nitro: "latest" },
        }),
      ),
    ]);

    const facts = await gatherBuildProjectFacts(
      {
        appId: 123_456,
        appPath,
        frameworkType: "vite",
      } as AgentContext,
      "vite build",
    );

    expect(facts.frameworkType).toBe("vite-nitro");
  });

  it("requires Next 16 isolated dev output before building beside a preview", () => {
    const safeNextFacts: BuildProjectFacts = {
      ...safeViteFacts,
      frameworkType: "nextjs",
      buildScript: "next build",
      nextMajorVersion: 16,
      nextDevOutputIsolated: true,
    };

    expect(selectBuildExecutionMode(safeNextFacts)).toBe("in-place");
    expect(
      selectBuildExecutionMode({ ...safeNextFacts, nextMajorVersion: 15 }),
    ).toBe("isolated");
    expect(
      selectBuildExecutionMode({
        ...safeNextFacts,
        nextDevOutputIsolated: false,
      }),
    ).toBe("isolated");
    expect(
      selectBuildExecutionMode({
        ...safeNextFacts,
        previewRunning: false,
        nextDevOutputIsolated: false,
      }),
    ).toBe("in-place");
  });

  it("isolates unknown builds only while a preview is running", () => {
    expect(
      selectBuildExecutionMode({
        ...safeViteFacts,
        frameworkType: null,
      }),
    ).toBe("isolated");
    expect(
      selectBuildExecutionMode({
        ...safeViteFacts,
        frameworkType: null,
        previewRunning: false,
      }),
    ).toBe("in-place");
  });

  it("rewrites links to source dependencies into the private snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "app");
    const snapshotRoot = path.join(root, "snapshot");
    await fs.mkdir(path.join(sourceRoot, "node_modules", "package"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourceRoot, "node_modules", "package", "index.js"),
      "export {};",
    );
    await fs.mkdir(path.join(snapshotRoot, "node_modules"), {
      recursive: true,
    });
    await fs.cp(
      path.join(sourceRoot, "node_modules", "package"),
      path.join(snapshotRoot, "node_modules", "package"),
      { recursive: true },
    );
    await fs.symlink(
      path.join(sourceRoot, "node_modules", "package"),
      path.join(snapshotRoot, "node_modules", "linked-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await secureSnapshotSymlinks(sourceRoot, snapshotRoot);

    const rewrittenTarget = await fs.realpath(
      path.join(snapshotRoot, "node_modules", "linked-package"),
    );
    expect(rewrittenTarget).toBe(
      await fs.realpath(path.join(snapshotRoot, "node_modules", "package")),
    );
  });

  it("rejects links from an isolated snapshot to external paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "app");
    const snapshotRoot = path.join(root, "snapshot");
    const externalRoot = path.join(root, "shared");
    await Promise.all([
      fs.mkdir(sourceRoot),
      fs.mkdir(snapshotRoot),
      fs.mkdir(externalRoot),
    ]);
    await fs.symlink(
      externalRoot,
      path.join(snapshotRoot, "linked-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      secureSnapshotSymlinks(sourceRoot, snapshotRoot),
    ).rejects.toMatchObject({
      kind: "precondition",
      message: expect.stringContaining("points outside the app"),
    });
  });

  it.runIf(process.platform !== "win32")(
    "uses Dirent metadata instead of serial lstat calls on POSIX",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
      temporaryDirectories.push(root);
      const sourceRoot = path.join(root, "app");
      const snapshotRoot = path.join(root, "snapshot");
      await Promise.all([fs.mkdir(sourceRoot), fs.mkdir(snapshotRoot)]);
      await fs.writeFile(path.join(snapshotRoot, "regular.txt"), "content");
      const lstat = vi.spyOn(fs, "lstat");

      try {
        await secureSnapshotSymlinks(sourceRoot, snapshotRoot);
        expect(lstat).not.toHaveBeenCalled();
      } finally {
        lstat.mockRestore();
      }
    },
  );

  it("rejects external file links in the Windows copy backend", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "app");
    const snapshotRoot = path.join(root, "snapshot");
    const externalFile = path.join(root, "external.txt");
    await Promise.all([
      fs.mkdir(sourceRoot),
      fs.mkdir(snapshotRoot),
      fs.writeFile(externalFile, "outside"),
    ]);
    const linkPath = path.join(sourceRoot, "external-link.txt");
    await fs.symlink(externalFile, linkPath, "file");

    await expect(
      copySnapshotEntriesOnWindows(
        sourceRoot,
        await fs.realpath(sourceRoot),
        snapshotRoot,
        [linkPath],
      ),
    ).rejects.toMatchObject({
      kind: "precondition",
      message: expect.stringContaining("points outside the app"),
    });
  });

  it("removes dangling links from an isolated snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "app");
    const snapshotRoot = path.join(root, "snapshot");
    await Promise.all([fs.mkdir(sourceRoot), fs.mkdir(snapshotRoot)]);
    const danglingLink = path.join(snapshotRoot, "missing-package");
    await fs.symlink(
      path.join(sourceRoot, "missing-package"),
      danglingLink,
      "file",
    );

    await secureSnapshotSymlinks(sourceRoot, snapshotRoot);

    await expect(fs.lstat(danglingLink)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("cleans only marked Dyad-owned snapshot directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-build-test-"));
    temporaryDirectories.push(root);
    const owned = path.join(root, ".dyad-build-ABC123");
    const unowned = path.join(root, ".dyad-build-DEF456");
    await Promise.all([fs.mkdir(owned), fs.mkdir(unowned)]);
    await fs.writeFile(
      path.join(owned, ".dyad-build-snapshot"),
      "dyad-build-snapshot-v1",
    );

    await removeStaleSnapshots(root, { removeAll: true });

    await expect(fs.lstat(owned)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(unowned)).resolves.toMatchObject({});
  });

  it("completes the status when the per-turn limit refuses a build", async () => {
    const onXmlComplete = vi.fn();
    const ctx = {
      appId: 42,
      appPath: "/unused",
      buildAttemptState: { count: 3 },
      onXmlComplete,
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;

    await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
      "3-build limit",
    );

    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('title="Build limit reached" state="warning"'),
    );
  });

  it("refuses to run a host build for an active cloud preview", async () => {
    runningApps.set(44, {
      mode: "cloud",
    } as never);
    const ctx = {
      appId: 44,
      appPath: "/unused",
      onXmlComplete: vi.fn(),
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;

    await expect(runBuildTool.execute({}, ctx)).rejects.toMatchObject({
      kind: "precondition",
      message: expect.stringContaining("cloud sandbox"),
    });
  });

  it("completes the status when an unchanged workspace refuses a retry", async () => {
    const onXmlComplete = vi.fn();
    const ctx = {
      appId: 43,
      appPath: "/unused",
      mutationCount: 7,
      buildAttemptState: { count: 1, mutationCountAtLastRun: 7 },
      onXmlComplete,
      onXmlStream: vi.fn(),
    } as unknown as AgentContext;

    await expect(runBuildTool.execute({}, ctx)).resolves.toContain(
      "workspace has not changed",
    );

    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('title="Build not repeated" state="warning"'),
    );
  });
});
