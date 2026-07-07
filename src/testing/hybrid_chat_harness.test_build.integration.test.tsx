import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ipc } from "@/ipc/types";
import { setupHybridChatHarness } from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

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

      await ipc.github.startFlow({ appId: harness.appId });

      const update = await harness.waitForEvent(
        "github:flow-update",
        (payload) =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { userCode?: unknown }).userCode === "FAKE-CODE",
      );
      expect(update.payload).toMatchObject({
        userCode: "FAKE-CODE",
      });

      await waitFor(
        () =>
          expect(
            harness.bridge.sentEvents.some(
              (event) => event.channel === "github:flow-success",
            ),
          ).toBe(true),
        { timeout: 15_000 },
      );
    } finally {
      await harness.dispose();
    }
  }, 60_000);
});
