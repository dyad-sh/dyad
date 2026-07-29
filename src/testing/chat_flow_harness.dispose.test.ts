// @vitest-environment node

import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apps, chats } from "@/db/schema";
import { chatStreamDefinition } from "@/chat_stream/definition";
import { chatStreamKey } from "@/chat_stream/transport";
import "@/ipc/services/distributed_machine_host";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { getActiveStreamCount } from "@/ipc/handlers/chat_stream_handlers";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("chat flow harness disposal", () => {
  let harness: ChatFlowHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
  });

  it("cancels and drains active streams before releasing shared resources", async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    const tempRoot = harness.userDataDir;
    const stream = harness.streamChat("[sleep=long]");

    await vi.waitFor(() => expect(getActiveStreamCount()).toBe(1), {
      timeout: 10_000,
    });

    const firstDisposal = harness.dispose();
    const secondDisposal = harness.dispose();
    expect(secondDisposal).toBe(firstDisposal);
    await expect(harness.streamChat("too late")).rejects.toThrow(
      "Cannot start a chat stream after harness disposal has begun",
    );
    await firstDisposal;
    await stream;

    expect(getActiveStreamCount()).toBe(0);
    expect(fs.existsSync(tempRoot)).toBe(false);
  }, 30_000);

  it("disposes actors for chats belonging to secondary harness apps", async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      registerChatStreamHandlers: false,
    });
    const [secondaryApp] = await harness.db
      .insert(apps)
      .values({ name: "secondary", path: harness.appDir })
      .returning();
    const [secondaryChat] = await harness.db
      .insert(chats)
      .values({ appId: secondaryApp.id })
      .returning();
    remoteMachineHost.localRef(
      chatStreamDefinition,
      chatStreamKey(secondaryChat.id),
    );

    expect(
      remoteMachineHost.peek(
        chatStreamDefinition.id,
        chatStreamKey(secondaryChat.id),
      ),
    ).toBeDefined();

    await harness.dispose();

    expect(
      remoteMachineHost.peek(
        chatStreamDefinition.id,
        chatStreamKey(secondaryChat.id),
      ),
    ).toBeUndefined();
  });
});
