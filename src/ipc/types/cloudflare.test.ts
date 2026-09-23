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
  const connectInput = {
    appId: 7,
    accountId: "a".repeat(32),
    rootDirectory: "",
    workerName: "demo",
    mode: "create",
  } as const;

  it("refreshes the app record when a Worker is connected", () => {
    const scopes = cloudflareContracts.connectWorker.invalidates!(
      connectInput,
      {
        status: "connected",
        connection: {
          rootDirectory: "",
          accountId: connectInput.accountId,
          workerName: "demo",
          workerUrl: "https://demo.acme.workers.dev",
          dashboardUrl: "https://dash.cloudflare.com/demo",
        },
      },
    );
    expect(scopes).toEqual([appScope]);
  });

  it("refreshes nothing when the Worker belongs to another repository", () => {
    // A conflict is reported before anything is written.
    const scopes = cloudflareContracts.connectWorker.invalidates!(
      connectInput,
      { status: "conflict", existingRepo: "acme/other" },
    );
    expect(scopes).toEqual([]);
  });

  it("refreshes the app record when a Worker is disconnected", () => {
    const scopes = cloudflareContracts.disconnect.invalidates!(
      { appId: 7, rootDirectory: "" },
      undefined,
    );
    expect(scopes).toEqual([appScope]);
  });
});
