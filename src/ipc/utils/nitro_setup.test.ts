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

  it("adds a start script in the manifest's own style", async () => {
    // Tabs and CRLF, which is what a manifest committed from another editor
    // looks like. Rewriting it as two-space LF turns a one-line addition into
    // a whole-file diff that churns every later merge.
    const manifest =
      [
        "{",
        '\t"name": "demo",',
        '\t"scripts": {',
        '\t\t"build": "vite build"',
        "\t}",
        "}",
      ].join("\r\n") + "\r\n";
    await fs.writeFile(path.join(appPath, "package.json"), manifest, "utf8");

    await ensureNitroOnViteApp(appPath);

    const written = await fs.readFile(
      path.join(appPath, "package.json"),
      "utf8",
    );
    expect(JSON.parse(written).scripts.start).toBe(
      "node .output/server/index.mjs",
    );
    expect(written).toContain("\r\n");
    expect(written).toContain('\t"scripts"');
    // No stray bare newlines left behind by the rewrite.
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("leaves a manifest it cannot parse alone", async () => {
    // Not this step's to repair, and throwing here would roll back the whole
    // Nitro conversion over a file it did not write.
    await fs.writeFile(
      path.join(appPath, "package.json"),
      "{ not json",
      "utf8",
    );

    await expect(ensureNitroOnViteApp(appPath)).resolves.toBeTruthy();

    expect(await fs.readFile(path.join(appPath, "package.json"), "utf8")).toBe(
      "{ not json",
    );
  });

  it("installs jiti alongside nitro", async () => {
    await ensureNitroOnViteApp(appPath);

    expect(installPackagesMock).toHaveBeenCalledWith({
      packages: ["nitro", "jiti"],
      appPath,
    });
  });
});
