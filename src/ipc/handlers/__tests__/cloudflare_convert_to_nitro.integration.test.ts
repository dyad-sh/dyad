import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { apps } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

/**
 * The package install is the one step that leaves the machine: it is replaced
 * by writing the dependencies into the manifest, which is what the detection
 * reads. Everything else is real: the files Nitro setup writes, the Vite
 * config patch, the git commit, and the detection over the committed branch.
 */
vi.mock("@/ipc/processors/executeAddDependency", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/ipc/processors/executeAddDependency")
    >();
  return {
    ...actual,
    installPackages: async ({
      packages,
      appPath,
    }: {
      packages: string[];
      appPath: string;
    }) => {
      const manifestPath = path.join(appPath, "package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.dependencies ??= {};
      for (const name of packages) manifest.dependencies[name] = "^0.0.0";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      return { warningMessages: [] };
    },
  };
});

/**
 * The Cloudflare tab reads the committed branch, so a plain Vite app shows no
 * target. The conversion has to leave the app in a state the same read finds
 * deployable: Nitro set up, committed, and waiting for a sync.
 */
describe("converting a plain Vite app to Nitro for Cloudflare (integration)", () => {
  let harness: HybridChatHarness;

  function git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: harness.appDir,
      encoding: "utf8",
    }).trim();
  }

  beforeAll(async () => {
    // The "minimal" fixture is a plain Vite app: a Vite config and a manifest
    // with no Nitro, and no Wrangler config anywhere.
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { enableCloudflareDeployment: true },
    });
    // The status reads the branch the app syncs to, which defaults to main;
    // the fixture repo's default branch depends on the machine's git config.
    git("branch", "-M", "main");
  }, 60_000);

  afterAll(async () => {
    writeSettings({ enableCloudflareDeployment: false });
    await harness?.dispose();
  });

  it("offers the conversion, then finds the committed Nitro app as a target", async () => {
    const before = await ipc.cloudflare.getAppStatus({ appId: harness.appId });
    expect(before.targets).toEqual([]);
    expect(before.canConvertToNitro).toBe(true);
    const commitsBefore = harness.gitLog().length;

    await expect(
      ipc.cloudflare.convertToNitro({ appId: harness.appId }),
    ).resolves.toEqual({ warnings: [] });

    // What the conversion writes, as the agent's enable_nitro does.
    expect(harness.appFileExists("nitro.config.ts")).toBe(true);
    expect(harness.appFileExists("server/routes/api/.gitkeep")).toBe(true);
    expect(harness.readAppFile("vite.config.ts")).toContain("nitro/vite");
    const manifest = JSON.parse(harness.readAppFile("package.json"));
    expect(manifest.dependencies.nitro).toBeDefined();
    expect(manifest.scripts.start).toBe("node .output/server/index.mjs");

    // All of it in one commit, and nothing left over.
    expect(git("status", "--porcelain")).toBe("");
    const log = harness.gitLog();
    expect(log).toHaveLength(commitsBefore + 1);
    expect(log[0]).toContain(
      "chore: add Nitro server layer for Cloudflare deployment",
    );

    // The same read that found nothing now finds a Nitro target at the root,
    // ahead of GitHub, so the tab asks for a sync rather than a conversion.
    const after = await ipc.cloudflare.getAppStatus({ appId: harness.appId });
    expect(after.targets).toEqual([
      expect.objectContaining({ kind: "nitro", rootDirectory: "" }),
    ]);
    expect(after.canConvertToNitro).toBe(false);
    expect(after.synced).toBe(false);

    // The app record now says Nitro too, which the chat prompt reads.
    const app = await ipc.app.getApp(harness.appId);
    expect(app.frameworkType).toBe("vite-nitro");
  }, 30_000);

  it("refuses a second conversion of an app it finds no changes in", async () => {
    // Nitro is committed on another branch than the one the app syncs to.
    await harness.db
      .update(apps)
      .set({ githubBranch: "release" })
      .where(eq(apps.id, harness.appId));
    const commitsBefore = harness.gitLog().length;

    await expect(
      ipc.cloudflare.convertToNitro({ appId: harness.appId }),
    ).rejects.toThrow(/already has a Nitro server layer/);
    expect(harness.gitLog()).toHaveLength(commitsBefore);
  });
});
