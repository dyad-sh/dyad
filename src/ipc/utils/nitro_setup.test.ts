import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNitroOnViteApp, hasCompleteNitroSetup } from "./nitro_setup";

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

  it("knows a finished setup from a tree missing either of its halves", async () => {
    await fs.writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "vite build" } }),
      "utf8",
    );
    expect(await hasCompleteNitroSetup(appPath)).toBe(false);

    // The install writes the dependencies, as the real one does.
    installPackagesMock.mockImplementation(async () => {
      const manifestPath = path.join(appPath, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.dependencies = { nitro: "^3.0.0", jiti: "^2.0.0" };
      await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
      return { warningMessages: [] };
    });
    await ensureNitroOnViteApp(appPath);
    expect(await hasCompleteNitroSetup(appPath)).toBe(true);

    // A setup killed after the config was written, before the install.
    const manifestPath = path.join(appPath, "package.json");
    const complete = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(complete);
    delete manifest.dependencies.nitro;
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    expect(await hasCompleteNitroSetup(appPath)).toBe(false);

    // A setup that failed after the install and rolled its files back.
    await fs.writeFile(manifestPath, complete, "utf8");
    await fs.rm(path.join(appPath, "nitro.config.ts"));
    expect(await hasCompleteNitroSetup(appPath)).toBe(false);
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

  it("fails the conversion when the manifest cannot be read", async () => {
    // An earlier version of this test asserted the opposite and passed only
    // because it mocked installPackages away — installPackages is what reads
    // the manifest first, so a broken one stops the conversion there.
    //
    // Which is what this asserts: the mock reads the file the way the real
    // one does, so a manifest that parses gets past it and a broken one does
    // not. Rejecting unconditionally would prove nothing about the manifest.
    installPackagesMock.mockImplementation(async ({ appPath: dir }) => {
      JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
      return { warningMessages: [] };
    });
    await fs.writeFile(
      path.join(appPath, "package.json"),
      "{ not json",
      "utf8",
    );

    await expect(ensureNitroOnViteApp(appPath)).rejects.toThrow();

    // Left as it was found, rather than rewritten by a step that never ran.
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
