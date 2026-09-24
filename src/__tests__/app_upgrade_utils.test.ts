import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import {
  isComponentTaggerUpgradeNeeded,
  applyComponentTagger,
  simpleSpawnWithDeniedPnpmBuildSelfHeal,
} from "../ipc/utils/app_upgrade_utils";
import { simpleSpawn } from "../ipc/utils/simpleSpawn";
import { gitAddAll, gitCommit } from "../ipc/utils/git_utils";
import { CommandExecutionError } from "../ipc/utils/socket_firewall";

const docker = vi.hoisted(() => ({
  active: false,
  resolveAppIdForPath: vi.fn(),
  runPackageManagerCommandInGuest: vi.fn(),
  resolvePnpmIgnoredBuilds: vi.fn(),
  recordAndReportDeniedPnpmBuilds: vi.fn(),
}));

vi.mock("@/ipc/services/docker_runtime/runtime_mode", () => ({
  isDockerRuntimeActive: () => docker.active,
}));

vi.mock("../ipc/utils/docker_package_manager", () => ({
  resolveAppIdForPath: docker.resolveAppIdForPath,
  runPackageManagerCommandInGuest: docker.runPackageManagerCommandInGuest,
}));

vi.mock("../ipc/utils/pnpm_denied_builds", () => ({
  resolvePnpmIgnoredBuilds: docker.resolvePnpmIgnoredBuilds,
  recordAndReportDeniedPnpmBuilds: docker.recordAndReportDeniedPnpmBuilds,
}));

vi.mock(
  "node:fs",
  async (importOriginal: () => Promise<typeof import("node:fs")>) => {
    const actual = await importOriginal();
    return {
      ...actual,
      promises: {
        ...actual.promises,
        readFile: vi.fn(),
        writeFile: vi.fn(),
      },
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    } as unknown as typeof import("node:fs");
  },
);

vi.mock("../ipc/utils/simpleSpawn", () => ({
  simpleSpawn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ipc/utils/git_utils", () => ({
  gitAddAll: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

describe("isComponentTaggerUpgradeNeeded Heuristics", () => {
  const mockPath = "/mock/app";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false if the project is not a Vite app (no config file)", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false);
  });

  it("should return true for a React Vite app needing upgrade", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react-swc';
      export default defineConfig({ plugins: [react()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(true);
  });

  it("should return false for a Vue Vite app (React heuristic filter)", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import vue from '@vitejs/plugin-vue';
      export default defineConfig({ plugins: [vue()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false); // Correctly filtered out
  });

  it("should return false if the React Vite app already has the tagger applied", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';
      export default defineConfig({ plugins: [dyadComponentTagger(), react()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false);
  });
});

describe("applyComponentTagger", () => {
  const mockPath = "/mock/app";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(`
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      export default defineConfig({ plugins: [react()] });
    `);
  });

  it("inserts tagger import and adds to plugins", async () => {
    let writtenContent = "";
    vi.spyOn(fs.promises, "writeFile").mockImplementation(
      async (path, content) => {
        if (typeof content === "string") {
          writtenContent = content;
        }
      },
    );

    await applyComponentTagger(mockPath);
    expect(writtenContent).toContain(
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    );
    expect(writtenContent).toContain("plugins: [dyadComponentTagger(), ");
    expect(gitAddAll).toHaveBeenCalled();
    expect(gitCommit).toHaveBeenCalled();
  });

  it("targets the plugins array after defineConfig when multiple exist", async () => {
    const originalContent = `
      // Some config or other tooling that has plugins
      const otherConfig = {
        plugins: [someTool()]
      };

      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      
      export default defineConfig({
        plugins: [react()]
      });
    `;
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(originalContent);

    let writtenContent = "";
    vi.spyOn(fs.promises, "writeFile").mockImplementation(
      async (path, content) => {
        if (typeof content === "string") {
          writtenContent = content;
        }
      },
    );

    await applyComponentTagger(mockPath);

    // The first plugins array (in otherConfig) should remain unchanged
    expect(writtenContent).toContain("plugins: [someTool()]");
    // The main plugins array under defineConfig should get the component tagger
    expect(writtenContent).toContain(
      "plugins: [dyadComponentTagger(), react()]",
    );
  });

  it("rollback when install fails", async () => {
    vi.mocked(simpleSpawn).mockRejectedValue(new Error("Install failed"));
    const rollbackSpy = vi.spyOn(fs.promises, "writeFile");

    await expect(applyComponentTagger(mockPath)).rejects.toThrow();
    expect(rollbackSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("plugins: [react()]"),
    );
  });

  it("skips dependency installation when installDependencies is false", async () => {
    // Override the default readFile mock to return appropriate content per file
    vi.spyOn(fs.promises, "readFile").mockImplementation(async (filePath) => {
      if (String(filePath).includes("package.json")) {
        return JSON.stringify({ devDependencies: {} });
      }
      return `
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      export default defineConfig({ plugins: [react()] });
      `;
    });

    const writtenFiles: Record<string, string> = {};
    vi.spyOn(fs.promises, "writeFile").mockImplementation(
      async (filePath, content) => {
        if (typeof content === "string") {
          writtenFiles[String(filePath)] = content;
        }
      },
    );

    await applyComponentTagger(mockPath, { installDependencies: false });

    // Check spawn was NOT called — no npm/pnpm install
    expect(simpleSpawn).not.toHaveBeenCalled();

    // Check vite config was modified
    const viteWrite = Object.entries(writtenFiles).find(([k]) =>
      k.includes("vite.config"),
    );
    expect(viteWrite).toBeDefined();
    expect(viteWrite![1]).toContain("dyadComponentTagger()");

    // Check package.json was updated with the tagger dependency
    const pkgWrite = Object.entries(writtenFiles).find(([k]) =>
      k.includes("package.json"),
    );
    expect(pkgWrite).toBeDefined();
    expect(pkgWrite![1]).toContain("@dyad-sh/react-vite-component-tagger");

    // Check git was still committed
    expect(gitAddAll).toHaveBeenCalled();
    expect(gitCommit).toHaveBeenCalled();
  });
});

describe("in Docker mode", () => {
  const mockPath = "/mock/app";
  const viteConfig = `
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      export default defineConfig({ plugins: [react()] });
    `;

  beforeEach(() => {
    vi.clearAllMocks();
    docker.active = true;
    docker.resolveAppIdForPath.mockResolvedValue(9);
    docker.runPackageManagerCommandInGuest.mockResolvedValue({
      stdout: "",
      stderr: "",
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(viteConfig);
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined);
  });

  afterEach(() => {
    docker.active = false;
  });

  it("installs the component tagger in the guest, never on the host", async () => {
    await applyComponentTagger(mockPath, { appId: 4 });

    expect(simpleSpawn).not.toHaveBeenCalled();
    expect(docker.runPackageManagerCommandInGuest).toHaveBeenCalledWith({
      appId: 4,
      appPath: mockPath,
      invocation: {
        command: "pnpm",
        args: [
          "--config.pm-on-fail=ignore",
          "add",
          "--ignore-workspace-root-check",
          "-D",
          "@dyad-sh/react-vite-component-tagger",
        ],
      },
    });
    expect(gitCommit).toHaveBeenCalled();
  });

  it("does not fall back to npm and rolls back when the guest install fails", async () => {
    docker.runPackageManagerCommandInGuest.mockRejectedValue(
      new CommandExecutionError({
        message: "failed",
        stderr: "ERR_PNPM_FETCH_404",
      }),
    );

    await expect(applyComponentTagger(mockPath, { appId: 4 })).rejects.toThrow(
      /Failed to install dependency via pnpm: failed[\s\S]*ERR_PNPM_FETCH_404/,
    );
    expect(simpleSpawn).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenLastCalledWith(
      expect.stringContaining("vite.config"),
      viteConfig,
    );
  });

  it("looks up the app ID and self-heals ignored builds from the guest output", async () => {
    docker.runPackageManagerCommandInGuest
      .mockRejectedValueOnce(
        new CommandExecutionError({
          message: "failed",
          stdout:
            "ERR_PNPM_IGNORED_BUILDS\nIgnored build scripts: esbuild@0.25.0.",
        }),
      )
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    docker.recordAndReportDeniedPnpmBuilds.mockResolvedValue({
      deniedBuilds: [{ packageName: "esbuild", packageSpec: "esbuild@0.25.0" }],
    });

    await simpleSpawnWithDeniedPnpmBuildSelfHeal({
      command: "pnpm --config.pm-on-fail=ignore install",
      cwd: mockPath,
      successMessage: "ok",
      errorPrefix: "Failed",
    });

    expect(docker.resolveAppIdForPath).toHaveBeenCalledWith(mockPath);
    // Host node_modules/.modules.yaml is not the guest install's.
    expect(docker.resolvePnpmIgnoredBuilds).not.toHaveBeenCalled();
    expect(docker.recordAndReportDeniedPnpmBuilds).toHaveBeenCalledWith({
      appPath: mockPath,
      ignoredBuilds: [
        { packageName: "esbuild", packageSpec: "esbuild@0.25.0" },
      ],
      source: "self-heal",
    });
    expect(docker.runPackageManagerCommandInGuest).toHaveBeenCalledTimes(2);
    expect(docker.runPackageManagerCommandInGuest).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 9 }),
    );
    expect(simpleSpawn).not.toHaveBeenCalled();
  });

  it("refuses commands that are not plain argument lists", async () => {
    await expect(
      simpleSpawnWithDeniedPnpmBuildSelfHeal({
        command: "npx cap add ios && npx cap add android",
        cwd: mockPath,
        successMessage: "ok",
        errorPrefix: "Failed",
        appId: 4,
      }),
    ).rejects.toThrow(/not a plain argument list/);
    expect(docker.runPackageManagerCommandInGuest).not.toHaveBeenCalled();
    expect(simpleSpawn).not.toHaveBeenCalled();
  });
});
