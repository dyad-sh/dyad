import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  restoreAppCodeFromVault,
  syncAppCodeToVault,
  vaultCodePath,
} from "@/ipc/utils/vault_code";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vault-code-"));
const appDir = path.join(scratch, "dyad-apps", "my-app");
const vaultRoot = path.join(scratch, "vault");

function write(base: string, relative: string, contents: string) {
  const full = path.join(base, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

beforeEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("syncAppCodeToVault", () => {
  it("mirrors source files into Code/<app-path>", async () => {
    write(appDir, "src/main.tsx", "export {};");
    write(appDir, "package.json", "{}");

    const copied = await syncAppCodeToVault({
      appDir,
      vaultRoot,
      appPath: "my-app",
    });

    expect(copied).toBe(2);
    const mirror = vaultCodePath(vaultRoot, "my-app");
    expect(fs.readFileSync(path.join(mirror, "src/main.tsx"), "utf8")).toBe(
      "export {};",
    );
  });

  it("keeps git history but drops dependencies and build output", async () => {
    write(appDir, ".git/HEAD", "ref: refs/heads/main");
    write(appDir, "node_modules/react/index.js", "junk");
    write(appDir, "dist/bundle.js", "junk");
    write(appDir, ".next/cache/x", "junk");
    write(appDir, "index.ts", "code");

    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });

    const mirror = vaultCodePath(vaultRoot, "my-app");
    // Continuing where you left off includes the version history.
    expect(fs.existsSync(path.join(mirror, ".git/HEAD"))).toBe(true);
    expect(fs.existsSync(path.join(mirror, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(mirror, "dist"))).toBe(false);
    expect(fs.existsSync(path.join(mirror, ".next"))).toBe(false);
  });

  it("returns 0 when the app directory does not exist", async () => {
    expect(
      await syncAppCodeToVault({
        appDir: path.join(scratch, "missing"),
        vaultRoot,
        appPath: "missing",
      }),
    ).toBe(0);
  });

  it("updates the mirror on re-sync", async () => {
    write(appDir, "a.txt", "v1");
    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });
    write(appDir, "a.txt", "v2");
    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });

    expect(
      fs.readFileSync(
        path.join(vaultCodePath(vaultRoot, "my-app"), "a.txt"),
        "utf8",
      ),
    ).toBe("v2");
  });
});

describe("restoreAppCodeFromVault", () => {
  it("restores a project whose working copy is gone", async () => {
    write(appDir, "src/app.tsx", "code");
    write(appDir, ".git/HEAD", "ref: refs/heads/main");
    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });
    fs.rmSync(appDir, { recursive: true });

    const result = await restoreAppCodeFromVault({
      vaultRoot,
      appPath: "my-app",
      appDir,
    });

    expect(result.restored).toBe(true);
    expect(fs.readFileSync(path.join(appDir, "src/app.tsx"), "utf8")).toBe(
      "code",
    );
    expect(fs.existsSync(path.join(appDir, ".git/HEAD"))).toBe(true);
  });

  it("never overwrites a working copy that has files", async () => {
    write(appDir, "current.txt", "local work");
    write(
      path.join(vaultRoot, "Code", "my-app"),
      "current.txt",
      "stale mirror",
    );

    const result = await restoreAppCodeFromVault({
      vaultRoot,
      appPath: "my-app",
      appDir,
    });

    expect(result.restored).toBe(false);
    expect(fs.readFileSync(path.join(appDir, "current.txt"), "utf8")).toBe(
      "local work",
    );
  });

  it("does nothing when the vault has no mirror", async () => {
    const result = await restoreAppCodeFromVault({
      vaultRoot,
      appPath: "never-synced",
      appDir: path.join(scratch, "dyad-apps", "never-synced"),
    });
    expect(result.restored).toBe(false);
  });

  it("round-trips: sync, delete, restore, re-sync", async () => {
    write(appDir, "main.ts", "v1");
    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });
    fs.rmSync(appDir, { recursive: true });
    await restoreAppCodeFromVault({ vaultRoot, appPath: "my-app", appDir });
    write(appDir, "main.ts", "v2");
    await syncAppCodeToVault({ appDir, vaultRoot, appPath: "my-app" });

    expect(
      fs.readFileSync(
        path.join(vaultCodePath(vaultRoot, "my-app"), "main.ts"),
        "utf8",
      ),
    ).toBe("v2");
  });
});
