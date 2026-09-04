import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseGitOverlayPaths,
  secureGitOverlaySymlinks,
} from "./git_overlay_workspace";

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
  vi.restoreAllMocks();
});

/** `git status --porcelain -z` output for the given `XY path` fields. */
function status(...fields: string[]): string {
  return `${fields.join("\0")}\0`;
}

describe("parseGitOverlayPaths exclusions", () => {
  it("drops installed environments at any depth", () => {
    // Node resolves up through every ancestor, so a sibling or parent
    // `node_modules` is as reachable from the app as its own — and a copied
    // virtualenv points its interpreter back at the live checkout.
    expect(
      parseGitOverlayPaths(
        status(
          "?? node_modules/left-pad/index.js",
          "?? groups/node_modules/left-pad/index.js",
          "?? services/api/.venv/pyvenv.cfg",
          "?? src/app.ts",
        ),
        "",
        new Set(),
      ),
    ).toEqual(["src/app.ts"]);
  });

  it("keeps the Yarn Berry tooling a project commits", () => {
    // `.yarnrc.yml` points `yarnPath` at `.yarn/releases/*`, and plugins,
    // patches and SDKs are equally required to install. Dropping the whole
    // `.yarn` tree would break a custom install command on any such project.
    expect(
      parseGitOverlayPaths(
        status(
          " M .yarn/releases/yarn-4.1.0.cjs",
          " M .yarn/plugins/@yarnpkg/plugin-typescript.cjs",
          " M .yarn/patches/react.patch",
          "?? .yarn/cache/left-pad-npm-1.3.0.zip",
          "?? .yarn/unplugged/esbuild/bin/esbuild",
          "?? .yarn/install-state.gz",
        ),
        "",
        new Set(),
      ),
    ).toEqual([
      ".yarn/patches/react.patch",
      ".yarn/releases/yarn-4.1.0.cjs",
      ".yarn/plugins/@yarnpkg/plugin-typescript.cjs",
    ]);
  });

  it("anchors generated-output names at the app, not at every depth", () => {
    // `rules/local-agent-tools.md`: `app/out/page.tsx` is application source.
    // Only the app's own `out/` is build output.
    expect(
      parseGitOverlayPaths(
        status("?? app/out/index.html", "?? app/src/out/page.tsx"),
        "app",
        new Set(["out"]),
      ),
    ).toEqual(["app/src/out/page.tsx"]);
  });
});

describe("secureGitOverlaySymlinks", () => {
  it("does not fail a Windows workspace when a dangling link needs privileges", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-overlay-link-test-"),
    );
    const sourceRoot = path.join(root, "source");
    const workspaceRoot = path.join(root, "workspace");
    await Promise.all([
      fs.mkdir(sourceRoot, { recursive: true }),
      fs.mkdir(workspaceRoot, { recursive: true }),
    ]);
    const linkPath = path.join(workspaceRoot, "generated-link");
    await fs.symlink(path.join(sourceRoot, "generated-target"), linkPath);
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    vi.spyOn(fs, "symlink").mockRejectedValueOnce(
      Object.assign(new Error("privilege not held"), { code: "EPERM" }),
    );

    try {
      await expect(
        secureGitOverlaySymlinks(sourceRoot, workspaceRoot),
      ).resolves.toBeUndefined();
      await expect(fs.lstat(linkPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
