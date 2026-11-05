import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ipc } from "@/ipc/types";
import { setupHybridChatHarness } from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { readSettings } from "@/main/settings";

type FlowStatePayload = {
  provider?: string;
  state?: { status?: string; userCode?: string };
};

describe("hybrid chat harness testBuild mode", () => {
  it("routes GitHub device flow through the harness fake server", async () => {
    const previousFetch = globalThis.fetch;
    const harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
      testBuild: true,
    });

    try {
      harness.mountSurface({ route: "/app-details" });
      await screen.findByTestId("app-details-page");

      const { started } = await ipc.connectionFlow.start({
        provider: "github",
        appId: harness.appId,
        expectedRevision: 0,
      });
      expect(started).toBe(true);

      const update = await harness.waitForEvent(
        "connection-flow:state-changed",
        (payload) => {
          const data = payload as FlowStatePayload;
          return (
            data?.provider === "github" &&
            data?.state?.status === "awaiting-return" &&
            data?.state?.userCode === "FAKE-CODE"
          );
        },
      );
      expect(update.payload).toMatchObject({
        provider: "github",
        state: { status: "awaiting-return", userCode: "FAKE-CODE" },
      });

      // The fake server authorizes immediately; once the poll succeeds the
      // access token is written and the flow advances past exchanging-token.
      await waitFor(
        () =>
          expect(
            harness.bridge.sentEvents.some((event) => {
              if (event.channel !== "connection-flow:state-changed") {
                return false;
              }
              const data = event.args[0] as FlowStatePayload;
              return (
                data?.provider === "github" &&
                data?.state?.status === "connected"
              );
            }),
          ).toBe(true),
        { timeout: 15_000 },
      );

      // Exercise the authenticated API after OAuth. Browser fetch can complete
      // the public device flow while silently stripping this request's token.
      expect(readSettings().githubAccessToken?.value).toBe(
        "fake_access_token_12345",
      );
      await expect(ipc.github.listRepos()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ full_name: "testuser/existing-app" }),
        ]),
      );
    } finally {
      await harness.dispose();
    }
    expect(globalThis.fetch).toBe(previousFetch);
  }, 60_000);
});
