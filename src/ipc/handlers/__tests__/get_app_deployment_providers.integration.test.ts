import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  apps,
  cloudflareAppConnections,
  coolifyAppConnections,
} from "@/db/schema";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import {
  setupHandlerTestHarness,
  type HandlerTestHarness,
} from "@/testing/handler_test_harness";

/**
 * The Publish panel opens on the first destination the app is connected to,
 * and learns which those are from the app record it already loads.
 * "Connected" is what Dyad has recorded locally for each destination.
 */

describe("get-app deployment providers (integration)", () => {
  let harness: HandlerTestHarness;
  let appDirectory: string;

  // One harness for the file: the app handlers include a legacy channel that
  // the electron mock refuses to register twice. Each case seeds its own app.
  beforeAll(() => {
    appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-get-app-deployments-"),
    );
    harness = setupHandlerTestHarness();
    registerAppHandlers();
  });

  afterAll(() => {
    harness.dispose();
    fs.rmSync(appDirectory, { recursive: true, force: true });
  });

  function seedApp(vercelProjectId: string | null = null): number {
    return harness.db
      .insert(apps)
      .values({ name: "demo", path: appDirectory, vercelProjectId })
      .returning()
      .get().id;
  }

  async function providersOf(appId: number) {
    const app = await harness.invokeHandler<{
      deploymentProvidersInUse: Record<string, boolean>;
    }>("get-app", appId);
    return app.deploymentProvidersInUse;
  }

  it("reports an app connected to nothing", async () => {
    await expect(providersOf(seedApp())).resolves.toEqual({
      vercel: false,
      cloudflare: false,
      coolify: false,
    });
  });

  it("counts a Vercel project on the app row", async () => {
    await expect(providersOf(seedApp("prj_123"))).resolves.toEqual({
      vercel: true,
      cloudflare: false,
      coolify: false,
    });
  });

  it("counts a Cloudflare Worker connection", async () => {
    const appId = seedApp();
    harness.db
      .insert(cloudflareAppConnections)
      .values({
        appId,
        rootDirectory: "",
        accountId: "a".repeat(32),
        workerName: "demo",
        workerTag: "tag",
        triggerUuid: "trigger",
      })
      .run();

    await expect(providersOf(appId)).resolves.toEqual({
      vercel: false,
      cloudflare: true,
      coolify: false,
    });
  });

  it("counts a Coolify connection, deployed or not", async () => {
    // A chosen server and project with nothing deployed yet is still where
    // the user is heading, so it counts the same as a finished deploy.
    const appId = seedApp();
    harness.db
      .insert(coolifyAppConnections)
      .values({ appId, serverUuid: "server", projectUuid: "project" })
      .run();

    await expect(providersOf(appId)).resolves.toEqual({
      vercel: false,
      cloudflare: false,
      coolify: true,
    });
  });

  it("keeps each app's connections to itself", async () => {
    const connected = seedApp();
    const other = seedApp();
    harness.db
      .insert(coolifyAppConnections)
      .values({ appId: connected, serverUuid: "server", projectUuid: "p" })
      .run();

    await expect(providersOf(other)).resolves.toEqual({
      vercel: false,
      cloudflare: false,
      coolify: false,
    });
  });
});
