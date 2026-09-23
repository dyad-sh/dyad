import { describe, expect, it } from "vitest";
import { cloudflareContracts } from "./cloudflare";

/**
 * The app record says which destinations the app is connected to, and the
 * Publish panel opens on the first of them. A Worker connected or removed
 * without refreshing that record would leave the panel opening on the wrong
 * tab until something else reloaded the app.
 */
describe("cloudflare contract invalidations", () => {
  const appScope = { family: "app", appId: 7 };

  it("refreshes the app record when a Worker is connected", () => {
    const scopes = cloudflareContracts.connectWorker.invalidates!(
      {
        appId: 7,
        accountId: "a".repeat(32),
        rootDirectory: "",
        workerName: "demo",
        mode: "create",
      },
      { status: "connected" } as never,
    );
    expect(scopes).toContainEqual(appScope);
  });

  it("refreshes the app record when a Worker is disconnected", () => {
    const scopes = cloudflareContracts.disconnect.invalidates!(
      { appId: 7, rootDirectory: "" },
      undefined,
    );
    expect(scopes).toContainEqual(appScope);
  });
});
