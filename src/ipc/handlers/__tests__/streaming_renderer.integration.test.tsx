import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("streaming renderer (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("keeps closed dyad-write blocks mounted while later blocks stream", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=streaming-render-multi-write",
      { chatId },
    );
    send();

    await screen.findByText(
      "StreamingRenderBlockA.tsx",
      {
        exact: true,
      },
      { timeout: 30_000 },
    );
    await screen.findByText(
      "StreamingRenderBlockE.tsx",
      { exact: true },
      { timeout: 30_000 },
    );
    expect(
      screen.getByText("StreamingRenderBlockA.tsx", { exact: true }),
    ).toBeTruthy();

    await harness.waitForStreamEnd(chatId, 60_000);

    for (const name of [
      "StreamingRenderBlockA.tsx",
      "StreamingRenderBlockB.tsx",
      "StreamingRenderBlockC.tsx",
      "StreamingRenderBlockD.tsx",
      "StreamingRenderBlockE.tsx",
    ]) {
      expect(screen.getByText(name, { exact: true })).toBeTruthy();
    }
  }, 60_000);

  it("shows pending write path and clears pending indicator after close tag", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=streaming-render-large-block",
      { chatId },
    );
    send();

    await screen.findByText("Writing...", {}, { timeout: 30_000 });
    expect(
      screen.getByText("StreamingRenderLargeBlock.tsx", { exact: true }),
    ).toBeTruthy();

    await harness.waitForStreamEnd(chatId, 60_000);

    expect(
      screen.getByText("StreamingRenderLargeBlock.tsx", { exact: true }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Writing...")).toBeNull());
  }, 60_000);
});
