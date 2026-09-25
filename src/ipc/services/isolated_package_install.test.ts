// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("@/ipc/utils/socket_firewall", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/socket_firewall")>()),
  getPnpmMinimumReleaseAgeSupport: vi.fn(),
}));
import { getPnpmMinimumReleaseAgeSupport } from "@/ipc/utils/socket_firewall";
import {
  resolvePackageManager,
  runCleanPackageInstall,
} from "./isolated_package_install";

it.each([
  { member: "npm", available: true, expected: "npm" },
  { member: "pnpm", available: true, expected: "pnpm" },
  { member: "pnpm", available: false, expected: "npm" },
])(
  "selects $expected for a $member member (pnpm available: $available)",
  async ({ member, available, expected }) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-mixed-workspaces-"),
    );
    try {
      const appPath = path.join(root, member, "app");
      await fs.mkdir(appPath, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ private: true, workspaces: ["npm/*"] }),
      );
      await fs.writeFile(
        path.join(root, "pnpm-workspace.yaml"),
        'packages:\n  - "pnpm/*"\n',
      );
      await fs.writeFile(
        path.join(root, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
      );
      vi.mocked(getPnpmMinimumReleaseAgeSupport).mockResolvedValue({
        available,
        minimumReleaseAgeSupported: available,
      });
      await expect(resolvePackageManager(appPath, root)).resolves.toMatchObject(
        { packageManager: expected, sourceInstallPath: root },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

it("keeps a guest install and its lockfile fallback retry in the guest", async () => {
  const guestCommand =
    await import("@/ipc/services/docker_runtime/guest_command");
  const spawnModule = await import("@/ipc/utils/spawn_streaming");
  const runGuest = vi
    .spyOn(guestCommand, "runGuestStreaming")
    .mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "ERR_PNPM_OUTDATED_LOCKFILE",
      aborted: false,
      timedOut: false,
    })
    .mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
    });
  const hostSpawn = vi.spyOn(spawnModule, "spawnStreaming");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-guest-install-"));
  try {
    const cwd = path.join(root, "app");
    await fs.mkdir(cwd);
    await fs.writeFile(path.join(cwd, "pnpm-lock.yaml"), "");
    const result = await runCleanPackageInstall({
      cwd,
      packageManager: "pnpm",
      guest: { appId: 7, snapshotRoot: root },
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ code: 0, hasLockfile: false });
    expect(hostSpawn).not.toHaveBeenCalled();
    const inputs = runGuest.mock.calls.map(([input]) => input);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toMatchObject({
        appId: 7,
        hostRoot: root,
        cwd,
        command: "pnpm",
        nodeModules: "in-tree",
      });
      // Only the guest's fixed base environment; no host variables.
      expect(input.env).toBeUndefined();
    }
    expect(inputs[0].args).toContain("--frozen-lockfile");
    expect(inputs[1].args).not.toContain("--frozen-lockfile");
  } finally {
    runGuest.mockRestore();
    hostSpawn.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
