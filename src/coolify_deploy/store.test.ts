import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/main/settings", () => ({
  readSettings: () => ({}),
  writeSettings: vi.fn(),
  DEFAULT_SETTINGS: {},
}));

import { apps, coolifyAppConnections } from "@/db/schema";
import { setupHandlerTestHarness } from "@/testing/handler_test_harness";
import type { HandlerTestHarness } from "@/testing/handler_test_harness";
import { readConnectionState, writeConnectionState } from "./store";

/**
 * A row is one deployment, keyed by the target it deploys to. An app is
 * allowed one at a time, and the writer is what keeps that true — the index
 * only stops the same target being stored twice.
 */
let harness: HandlerTestHarness;
let appId: number;

const TARGET = {
  serverUuid: "srv-a",
  projectUuid: "prj-1",
  environmentName: "production",
};

beforeEach(async () => {
  harness = setupHandlerTestHarness();
  const [row] = await harness.db
    .insert(apps)
    .values({ name: "demo", path: "/tmp/demo" })
    .returning();
  appId = row.id;
});

function rows() {
  return harness.db.query.coolifyAppConnections.findMany({
    where: eq(coolifyAppConnections.appId, appId),
  });
}

describe("writing a connection", () => {
  it("leaves one row carrying the new values when the target is unchanged", async () => {
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: "app.example.com",
    });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].domain).toBe("app.example.com");
  });

  it("leaves one row when the app moves to another server", async () => {
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      serverUuid: "srv-b",
      domain: null,
    });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].serverUuid).toBe("srv-b");
    // And the app still reads as connected to exactly that one.
    const state = await readConnectionState(appId);
    expect(state.kind).toBe("configured");
    expect(state.kind !== "none" && state.serverUuid).toBe("srv-b");
  });

  it("leaves one row when only the environment changes", async () => {
    // The case a key without environment_name could not tell apart: same app,
    // same server, same project.
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      environmentName: "staging",
      domain: null,
    });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].environmentName).toBe("staging");
  });

  it("removes the row entirely when disconnected", async () => {
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });
    await writeConnectionState(appId, { kind: "none" });

    expect(await rows()).toHaveLength(0);
    expect((await readConnectionState(appId)).kind).toBe("none");
  });

  it("keeps one app's connection out of another's", async () => {
    const [other] = await harness.db
      .insert(apps)
      .values({ name: "other", path: "/tmp/other" })
      .returning();
    await writeConnectionState(appId, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });
    await writeConnectionState(other.id, {
      kind: "configured",
      ...TARGET,
      domain: null,
    });

    // Same target, different apps: both survive, since the key carries app_id.
    expect(await rows()).toHaveLength(1);
    expect((await readConnectionState(other.id)).kind).toBe("configured");
  });
});
