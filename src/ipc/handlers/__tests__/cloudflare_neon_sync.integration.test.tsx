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
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

/**
 * The Database section offers to sync the Neon config to Cloudflare only for
 * an app deployed to a Worker.
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
    writeSettings({ neon: undefined });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  /** A Neon app with a deploy branch chosen, deployed to Vercel and maybe to a Worker. */
  async function seedNeonApp({ withWorker }: { withWorker: boolean }) {
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
    if (!withWorker) return;
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

  it("offers the Sync to Cloudflare row for an app deployed to a Worker", async () => {
    await seedNeonApp({ withWorker: true });
    mountDatabaseSection();

    expect(await screen.findByTestId("sync-to-cloudflare")).toBeTruthy();
  });

  it("does not offer the row for an app with no Worker", async () => {
    await seedNeonApp({ withWorker: false });
    mountDatabaseSection();

    // The Vercel row shows that the section reached the state where sync
    // rows are offered at all.
    await screen.findByTestId("sync-to-vercel");
    expect(screen.queryByTestId("sync-to-cloudflare")).toBeNull();
  });
});
