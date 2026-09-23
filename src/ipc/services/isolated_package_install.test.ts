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
import { resolvePackageManager } from "./isolated_package_install";

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
