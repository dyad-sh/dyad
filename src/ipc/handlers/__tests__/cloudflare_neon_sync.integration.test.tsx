import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import { cleanup, screen } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, cloudflareAppConnections } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

/**
 * The Cloudflare experiment flag hides the Cloudflare tab. These check what
 * the Neon sync does on either side of that flag: the Database section's
 * sync row goes with the tab, while the cleanup on Neon disconnect does not.
 */
describe("Neon config sync to Cloudflare (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(async () => {
    cleanup();
    await harness.db.delete(cloudflareAppConnections);
    writeSettings({ neon: undefined, enableCloudflareDeployment: false });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  /** A Neon app with a deploy branch chosen, deployed to Vercel and to a Worker. */
  async function seedNeonAppWithWorker() {
    writeSettings({
      isTestMode: true,
      neon: {
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    await harness.db
      .update(apps)
      .set({
        neonProjectId: "test-project-id",
        neonDevelopmentBranchId: "test-development-branch-id",
        neonActiveBranchId: "test-development-branch-id",
        selectedDatabaseBranchType: "production",
        vercelProjectId: "prj_test",
      })
      .where(eq(apps.id, harness.appId));
    await harness.db.insert(cloudflareAppConnections).values({
      appId: harness.appId,
      rootDirectory: "",
      accountId: "acct-1",
      workerName: "shop",
      workerTag: "tag-1",
      triggerUuid: "trigger-1",
      workerUrl: "https://shop.acme.workers.dev",
    });
  }

  function mountDatabaseSection() {
    harness.mountSurface({ route: "/database", appId: harness.appId });
  }

  it("hides the Sync to Cloudflare row while the experiment is off", async () => {
    await seedNeonAppWithWorker();
    mountDatabaseSection();

    // The Vercel row shows that the section reached the state where sync
    // rows are offered at all.
    await screen.findByTestId("sync-to-vercel");
    expect(screen.queryByTestId("sync-to-cloudflare")).toBeNull();
  });

  it("offers the row once the experiment is on", async () => {
    await seedNeonAppWithWorker();
    writeSettings({ enableCloudflareDeployment: true });
    mountDatabaseSection();

    expect(await screen.findByTestId("sync-to-cloudflare")).toBeTruthy();
  });

  it("removes the secrets on Neon disconnect whether or not the experiment is on", async () => {
    await expect(
      ipc.cloudflare.removeNeonEnvVars({ appId: harness.appId }),
    ).resolves.toEqual({ removedKeys: [] });
    // Syncing stays with the tab.
    await expect(
      ipc.cloudflare.syncNeonConfig({ appId: harness.appId }),
    ).rejects.toThrow(/not enabled/);
  });
});
