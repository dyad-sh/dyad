import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("subscription status banner (integration)", () => {
  let harness: HybridChatHarness;
  let server: Server;
  let receivedAuthorization: string | undefined;
  let previousSubscriptionStatusUrl: string | undefined;

  beforeAll(async () => {
    previousSubscriptionStatusUrl = process.env.DYAD_SUBSCRIPTION_STATUS_URL;
    server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          alert: "subscription_paused",
          effectiveAt: "2026-08-03T00:00:00.000Z",
          actionUrl: "https://academy.dyad.sh/subscription?source=integration",
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start subscription status test server");
    }
    process.env.DYAD_SUBSCRIPTION_STATUS_URL = `http://127.0.0.1:${address.port}/subscription-status`;

    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: {
        isTestMode: true,
        providerSettings: {
          auto: { apiKey: { value: "integration-pro-key" } },
        },
      },
    });
  }, 60_000);

  afterEach(() => cleanup());

  afterAll(async () => {
    await harness?.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousSubscriptionStatusUrl === undefined) {
      delete process.env.DYAD_SUBSCRIPTION_STATUS_URL;
    } else {
      process.env.DYAD_SUBSCRIPTION_STATUS_URL = previousSubscriptionStatusUrl;
    }
  });

  it("renders Academy status through the real main-process IPC handler", async () => {
    harness.mountSurface({
      route: "/",
      withSubscriptionStatusBanner: true,
    });
    const banner = await screen.findByTestId("subscription-status-banner");
    expect(banner.dataset.alert).toBe("subscription_paused");
    expect(banner.textContent).toContain("Resume subscription");
    expect(receivedAuthorization).toBe("Bearer integration-pro-key");
  });
});
