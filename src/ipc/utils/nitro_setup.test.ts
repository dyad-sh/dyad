import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNitroOnViteApp } from "./nitro_setup";

const { installPackagesMock } = vi.hoisted(() => ({
  installPackagesMock: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/processors/executeAddDependency", () => ({
  ExecuteAddDependencyError: class ExecuteAddDependencyError extends Error {
    warningMessages: string[] = [];
  },
  installPackages: installPackagesMock,
}));

describe("nitro_setup", () => {
  let appPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    installPackagesMock.mockResolvedValue({ warningMessages: [] });
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "nitro-setup-"));
    await fs.writeFile(
      path.join(appPath, "vite.config.ts"),
      `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
});
`,
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("installs jiti alongside nitro", async () => {
    await ensureNitroOnViteApp(appPath);

    expect(installPackagesMock).toHaveBeenCalledWith({
      packages: ["nitro", "jiti"],
      appPath,
    });
  });
});
