import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectPackageAnchoredExcludedPaths,
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
  it("does not fail a Windows workspace when a dangling link needs privileges", async (ctx) => {
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
    // The fixture needs a REAL dangling link, and creating one on Windows
    // requires Developer Mode or elevation — the very privilege this test is
    // about not having. Without the guard the setup itself throws EPERM and
    // the test fails on a privilege-less runner for a reason unrelated to the
    // behaviour under test.
    try {
      await fs.symlink(path.join(sourceRoot, "generated-target"), linkPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES") throw error;
      await fs.rm(root, { recursive: true, force: true });
      ctx.skip();
      return;
    }
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

describe("package-root-anchored output exclusions", () => {
  const collect = async (trackedPaths: string[], names: string[]) =>
    parseGitOverlayPaths(
      status(
        "?? packages/web/.next/build-manifest.json",
        "?? packages/web/dist/index.js",
        "?? packages/api/coverage/lcov.info",
        "?? packages/web/src/index.tsx",
        "?? app/out/page.tsx",
      ),
      "apps/store",
      new Set(names),
      await collectPackageAnchoredExcludedPaths({
        trackedPaths,
        targetRelativePath: "apps/store",
        excludedTargetRootNames: new Set(names),
      }),
    );

  it("drops a sibling package's generated output", async () => {
    // The overlay runs from the repository top level while the excluded names
    // are anchored at the app, so without this a monorepo copies every sibling
    // package's build output into the sandbox on every run.
    expect(
      await collect(
        [
          "package.json",
          "packages/web/package.json",
          "packages/api/package.json",
          "apps/store/package.json",
        ],
        ["dist", "out", ".next", "coverage"],
      ),
    ).toEqual(["app/out/page.tsx", "packages/web/src/index.tsx"]);
  });

  it("keeps a sibling's output when Git tracks content under it", async () => {
    // Committed output is a build INPUT, exactly as it is for the app's own
    // roots — dropping it would pin the sandbox to its HEAD contents.
    expect(
      await collect(
        [
          "packages/web/package.json",
          "packages/web/dist/vendor.js",
          "packages/api/package.json",
        ],
        ["dist", "coverage"],
      ),
    ).toContain("packages/web/dist/index.js");
  });

  it("never anchors at a directory that is not a package root", async () => {
    // `app/` has no package.json, so `app/out/page.tsx` stays source — the
    // exact case `rules/local-agent-tools.md` warns depth-matching would break.
    expect(await collect(["package.json"], ["out", "dist", ".next"])).toContain(
      "app/out/page.tsx",
    );
  });

  it("requires an exact package.json segment", async () => {
    // `configs/tsconfig.package.json` does not make `configs` a package root,
    // and treating it as one would silently drop that directory's `dist` from
    // the overlay — source, in a directory declaring no package at all.
    expect(
      await collectPackageAnchoredExcludedPaths({
        trackedPaths: ["configs/tsconfig.package.json", "package.json"],
        targetRelativePath: "apps/store",
        excludedTargetRootNames: new Set(["dist"]),
      }),
    ).toEqual(new Set(["dist"]));
  });

  it("finds a package root that has never been committed", async () => {
    // A workspace package added but not yet committed appears only in the live
    // status, and `--untracked-files=normal` collapses it to one directory
    // entry — so without a filesystem check its ignored `dist` rides into every
    // sandbox.
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-overlay-pkg-test-"),
    );
    try {
      await fs.mkdir(path.join(root, "packages", "new"), { recursive: true });
      await fs.writeFile(
        path.join(root, "packages", "new", "package.json"),
        "{}",
      );
      expect(
        await collectPackageAnchoredExcludedPaths({
          sourceRoot: root,
          trackedPaths: [],
          overlayPaths: ["packages/new"],
          targetRelativePath: "apps/store",
          excludedTargetRootNames: new Set(["dist"]),
        }),
      ).toEqual(new Set(["packages/new/dist"]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
