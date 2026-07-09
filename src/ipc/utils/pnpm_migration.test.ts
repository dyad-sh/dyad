import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const {
  ensurePnpmAllowBuildsConfiguredMock,
  getPnpmMinimumReleaseAgeSupportMock,
  simpleSpawnWithDeniedPnpmBuildSelfHealMock,
  gitAddMock,
  gitCommitMock,
  resolvePnpmIgnoredBuildsMock,
  recordAndReportDeniedPnpmBuildsMock,
  sendTelemetryEventMock,
} = vi.hoisted(() => ({
  ensurePnpmAllowBuildsConfiguredMock: vi.fn(),
  getPnpmMinimumReleaseAgeSupportMock: vi.fn(),
  simpleSpawnWithDeniedPnpmBuildSelfHealMock: vi.fn(),
  gitAddMock: vi.fn(),
  gitCommitMock: vi.fn(),
  resolvePnpmIgnoredBuildsMock: vi.fn(),
  recordAndReportDeniedPnpmBuildsMock: vi.fn(),
  sendTelemetryEventMock: vi.fn(),
}));

vi.mock("@/ipc/utils/socket_firewall", async () => {
  const actual = await vi.importActual<
    typeof import("@/ipc/utils/socket_firewall")
  >("@/ipc/utils/socket_firewall");
  return {
    ...actual,
    ensurePnpmAllowBuildsConfigured: ensurePnpmAllowBuildsConfiguredMock,
    getPnpmMinimumReleaseAgeSupport: getPnpmMinimumReleaseAgeSupportMock,
  };
});

vi.mock("@/ipc/utils/app_upgrade_utils", () => ({
  simpleSpawnWithDeniedPnpmBuildSelfHeal:
    simpleSpawnWithDeniedPnpmBuildSelfHealMock,
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd: gitAddMock,
  gitCommit: gitCommitMock,
}));

vi.mock("@/ipc/utils/pnpm_denied_builds", () => ({
  resolvePnpmIgnoredBuilds: resolvePnpmIgnoredBuildsMock,
  recordAndReportDeniedPnpmBuilds: recordAndReportDeniedPnpmBuildsMock,
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: sendTelemetryEventMock,
}));

import {
  applyPnpmVersionMigration,
  getManagedPnpmMajorVersion,
  isPnpmVersionMigrationNeeded,
  parsePinnedPnpmMajorVersion,
  parsePnpmLockfileVersion,
} from "./pnpm_migration";
import { DyadErrorKind } from "@/errors/dyad_error";

async function createTempAppDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-migration-"));
}

async function writeAppFiles(
  appPath: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(appPath, relativePath), content);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  ensurePnpmAllowBuildsConfiguredMock.mockResolvedValue({
    changed: false,
    promotedPackages: [],
  });
  getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
    available: true,
    minimumReleaseAgeSupported: true,
    version: "11.10.0",
  });
  simpleSpawnWithDeniedPnpmBuildSelfHealMock.mockResolvedValue(undefined);
  gitAddMock.mockResolvedValue(undefined);
  gitCommitMock.mockResolvedValue(undefined);
  resolvePnpmIgnoredBuildsMock.mockResolvedValue([]);
  recordAndReportDeniedPnpmBuildsMock.mockResolvedValue({ deniedBuilds: [] });
});

describe("parsePnpmLockfileVersion", () => {
  it.each([
    ["lockfileVersion: '9.0'\n\nsettings:\n", 9],
    ['lockfileVersion: "6.0"\n', 6],
    ["lockfileVersion: 5.4\n", 5.4],
  ])("parses %j", (content, expected) => {
    expect(parsePnpmLockfileVersion(content)).toBe(expected);
  });

  it("returns null when the version line is missing", () => {
    expect(
      parsePnpmLockfileVersion("settings:\n  autoInstallPeers: true\n"),
    ).toBeNull();
  });
});

describe("parsePinnedPnpmMajorVersion", () => {
  it.each([
    ["pnpm@8.15.9", 8],
    ["pnpm@10.2.0+sha512.abcdef", 10],
  ])("parses %s", (field, expected) => {
    expect(parsePinnedPnpmMajorVersion(field)).toBe(expected);
  });

  it("returns null for non-pnpm or missing pins", () => {
    expect(parsePinnedPnpmMajorVersion("npm@10.8.2")).toBeNull();
    expect(parsePinnedPnpmMajorVersion(null)).toBeNull();
  });
});

describe("isPnpmVersionMigrationNeeded", () => {
  it("is needed for a pre-9 lockfile without a pin", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }),
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(true);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("is needed for a pnpm 8 pin even with a 9.0 lockfile", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({
          name: "app",
          packageManager: "pnpm@8.15.9",
        }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(true);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("is not needed for a 9.0 lockfile with a modern pin", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({
          name: "app",
          packageManager: "pnpm@10.2.0",
        }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(false);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("is not needed for a 9.0 pnpm lockfile with no packageManager pin", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(false);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("reads only the lockfile header when checking the lockfile version", async () => {
    const appPath = await createTempAppDir();
    const readSyncSpy = vi.spyOn(fs, "readSync");
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }),
        "pnpm-lock.yaml": `lockfileVersion: '6.0'\n${"ignored:\n".repeat(10_000)}`,
      });

      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(true);

      expect(readSyncSpy).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Buffer),
        0,
        512,
        0,
      );
    } finally {
      readSyncSpy.mockRestore();
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("is not needed for npm-shaped apps even with stale pnpm leftovers", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({
          name: "app",
          packageManager: "npm@10.8.2",
        }),
        "package-lock.json": "{}",
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(false);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("is not needed when there is no lockfile and no pin", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }),
      });
      expect(isPnpmVersionMigrationNeeded(appPath)).toBe(false);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });
});

describe("applyPnpmVersionMigration", () => {
  it("updates the pin, reinstalls, records denials, and commits", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify(
          { name: "app", packageManager: "pnpm@8.15.9" },
          null,
          2,
        ),
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      resolvePnpmIgnoredBuildsMock.mockResolvedValue([
        { packageName: "core-js", packageSpec: "core-js@3.49.0" },
      ]);

      await applyPnpmVersionMigration({ appPath });

      const packageJson = JSON.parse(
        await readFile(path.join(appPath, "package.json"), "utf8"),
      );
      expect(packageJson.packageManager).toBe("pnpm@11.10.0");

      expect(simpleSpawnWithDeniedPnpmBuildSelfHealMock).toHaveBeenCalledWith(
        expect.objectContaining({
          command:
            "pnpm --config.pm-on-fail=ignore --config.confirmModulesPurge=false --config.strictDepBuilds=false install",
          cwd: appPath,
        }),
      );
      expect(
        ensurePnpmAllowBuildsConfiguredMock.mock.invocationCallOrder[0],
      ).toBeLessThan(
        simpleSpawnWithDeniedPnpmBuildSelfHealMock.mock.invocationCallOrder[0],
      );
      expect(recordAndReportDeniedPnpmBuildsMock).toHaveBeenCalledWith({
        appPath,
        ignoredBuilds: [
          { packageName: "core-js", packageSpec: "core-js@3.49.0" },
        ],
        source: "app-upgrade",
      });
      expect(gitAddMock).toHaveBeenCalledWith({
        path: appPath,
        filepath: "package.json",
      });
      expect(gitAddMock).toHaveBeenCalledWith({
        path: appPath,
        filepath: "pnpm-lock.yaml",
      });
      expect(gitCommitMock).toHaveBeenCalledWith({
        path: appPath,
        message: `[dyad] migrate to pnpm ${getManagedPnpmMajorVersion()}`,
      });
      expect(sendTelemetryEventMock).toHaveBeenCalledWith(
        "pnpm:version-migration-applied",
        {
          fromLockfileVersion: 6,
          toPnpmVersion: "11.10.0",
        },
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("commits pnpm workspace policy changes with the migration", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }, null, 2),
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      ensurePnpmAllowBuildsConfiguredMock.mockResolvedValue({
        changed: true,
        promotedPackages: [],
      });

      await applyPnpmVersionMigration({ appPath });

      expect(gitAddMock).toHaveBeenCalledWith({
        path: appPath,
        filepath: "pnpm-workspace.yaml",
      });
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("surfaces a pin-write failure with manual guidance", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": "{",
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });

      await expect(
        applyPnpmVersionMigration({ appPath }),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.External,
        message:
          "Dependencies were reinstalled but the packageManager pin could not be updated. Please update package.json manually.",
      });
      expect(gitCommitMock).not.toHaveBeenCalled();
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("adds a pin when the project had none", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }, null, 2),
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });

      await applyPnpmVersionMigration({ appPath });

      const packageJson = JSON.parse(
        await readFile(path.join(appPath, "package.json"), "utf8"),
      );
      expect(packageJson.packageManager).toBe("pnpm@11.10.0");
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("leaves the pin untouched when the install fails", async () => {
    const appPath = await createTempAppDir();
    try {
      const originalPackageJson = JSON.stringify(
        { name: "app", packageManager: "pnpm@8.15.9" },
        null,
        2,
      );
      await writeAppFiles(appPath, {
        "package.json": originalPackageJson,
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      simpleSpawnWithDeniedPnpmBuildSelfHealMock.mockRejectedValue(
        new Error("Failed to reinstall dependencies with pnpm"),
      );

      await expect(applyPnpmVersionMigration({ appPath })).rejects.toThrow(
        "Failed to reinstall dependencies with pnpm",
      );
      await expect(
        readFile(path.join(appPath, "package.json"), "utf8"),
      ).resolves.toBe(originalPackageJson);
      expect(gitCommitMock).not.toHaveBeenCalled();
      expect(sendTelemetryEventMock).not.toHaveBeenCalled();
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("throws without touching the app when the available pnpm predates the 9.0 lockfile", async () => {
    const appPath = await createTempAppDir();
    try {
      const originalPackageJson = JSON.stringify(
        { name: "app", packageManager: "pnpm@8.15.9" },
        null,
        2,
      );
      await writeAppFiles(appPath, {
        "package.json": originalPackageJson,
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: true,
        minimumReleaseAgeSupported: false,
        version: "8.15.9",
      });

      await expect(applyPnpmVersionMigration({ appPath })).rejects.toThrow(
        "older than pnpm 9",
      );
      await expect(
        readFile(path.join(appPath, "package.json"), "utf8"),
      ).resolves.toBe(originalPackageJson);
      expect(simpleSpawnWithDeniedPnpmBuildSelfHealMock).not.toHaveBeenCalled();
      expect(gitCommitMock).not.toHaveBeenCalled();
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("throws without touching the app when pnpm is unavailable", async () => {
    const appPath = await createTempAppDir();
    try {
      const originalPackageJson = JSON.stringify(
        { name: "app", packageManager: "pnpm@8.15.9" },
        null,
        2,
      );
      await writeAppFiles(appPath, {
        "package.json": originalPackageJson,
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
        available: false,
        minimumReleaseAgeSupported: false,
      });

      await expect(applyPnpmVersionMigration({ appPath })).rejects.toThrow(
        "pnpm is not available",
      );
      await expect(
        readFile(path.join(appPath, "package.json"), "utf8"),
      ).resolves.toBe(originalPackageJson);
      expect(simpleSpawnWithDeniedPnpmBuildSelfHealMock).not.toHaveBeenCalled();
      expect(gitCommitMock).not.toHaveBeenCalled();
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("surfaces a commit failure with manual guidance", async () => {
    const appPath = await createTempAppDir();
    try {
      await writeAppFiles(appPath, {
        "package.json": JSON.stringify({ name: "app" }, null, 2),
        "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      });
      gitCommitMock.mockRejectedValue(new Error("not a git repository"));

      await expect(applyPnpmVersionMigration({ appPath })).rejects.toThrow(
        "could not be committed",
      );
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });
});

describe("getManagedPnpmMajorVersion", () => {
  it("derives the major from the managed install package", () => {
    expect(getManagedPnpmMajorVersion()).toBeGreaterThanOrEqual(11);
  });
});
