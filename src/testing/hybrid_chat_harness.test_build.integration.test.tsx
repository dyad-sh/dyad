import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ipc } from "@/ipc/types";
import { setupHybridChatHarness } from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

type FlowStatePayload = {
  provider?: string;
  state?: { status?: string; userCode?: string };
};

describe("hybrid chat harness testBuild mode", () => {
  it("routes GitHub device flow through the harness fake server", async () => {
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
                (data?.state?.status === "loading-resources" ||
                  data?.state?.status === "connected")
              );
            }),
          ).toBe(true),
        { timeout: 15_000 },
      );
    } finally {
      await harness.dispose();
    }
  }, 60_000);
});
