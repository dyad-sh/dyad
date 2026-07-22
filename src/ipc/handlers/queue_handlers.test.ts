import { describe, it, expect, vi, beforeEach } from "vitest";

// Records ipcMain.handle handlers and ipcMain.on listeners so the test can
// invoke the registered one-way write listener directly, without Electron.
const h = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcListeners: new Map<string, Array<(...args: unknown[]) => void>>(),
}));

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

const storeMock = vi.hoisted(() => ({
  writePersistedQueue: vi.fn<(queue: unknown) => Promise<void>>(async () => {}),
  readPersistedQueue: vi.fn(async () => ({})),
}));
vi.mock("../../main/queue_store", () => storeMock);

import { registerQueueHandlers } from "./queue_handlers";
import { queueSendContracts } from "../types/queue";

const CHANNEL = queueSendContracts.setQueuedPrompts.channel;

function getWriteListener(): (event: unknown, payload: unknown) => void {
  const listeners = h.ipcListeners.get(CHANNEL);
  const listener = listeners?.[listeners.length - 1];
  if (!listener) throw new Error(`No listener registered for ${CHANNEL}`);
  return listener as (event: unknown, payload: unknown) => void;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("registerQueueHandlers - one-way write", () => {
  beforeEach(() => {
    h.ipcHandlers.clear();
    h.ipcListeners.clear();
    storeMock.writePersistedQueue.mockClear();
    storeMock.writePersistedQueue.mockImplementation(async () => {});
    registerQueueHandlers();
  });

  it("registers the write channel as a one-way listener, not an invoke handler", () => {
    // The whole point of the fix: no reply-expecting handler for this channel,
    // so the main process never replies to a frame destroyed during teardown.
    expect(h.ipcHandlers.has(CHANNEL)).toBe(false);
    expect(h.ipcListeners.get(CHANNEL)?.length).toBe(1);
  });

  it("persists a valid queue payload", async () => {
    const queue = {
      "1": [
        {
          id: "a",
          prompt: "hello",
          redo: true,
          appId: 9,
          requestedChatMode: null,
        },
      ],
    };
    getWriteListener()({}, queue);
    await flush();
    expect(storeMock.writePersistedQueue).toHaveBeenCalledTimes(1);
    expect(storeMock.writePersistedQueue).toHaveBeenCalledWith(queue);
  });

  it("drops an invalid payload without writing or throwing", async () => {
    // Non-array value and non-canonical chat-id key are both rejected.
    expect(() => getWriteListener()({}, { "1": "not-an-array" })).not.toThrow();
    expect(() => getWriteListener()({}, { "01": [] })).not.toThrow();
    expect(() =>
      getWriteListener()(
        {},
        {
          "1": [{ id: "a", prompt: "hello", requestedChatMode: "bogus" }],
        },
      ),
    ).not.toThrow();
    await flush();
    expect(storeMock.writePersistedQueue).not.toHaveBeenCalled();
  });

  it("serializes writes so a slower write cannot clobber a newer snapshot", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    storeMock.writePersistedQueue
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first");
      })
      .mockImplementationOnce(async () => {
        order.push("second");
      });

    getWriteListener()({}, { "1": [{ id: "a", prompt: "first" }] });
    getWriteListener()({}, { "1": [{ id: "b", prompt: "second" }] });
    await flush();

    // The second write must not run until the first settles.
    expect(order).toEqual([]);
    releaseFirst();
    await flush();
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps persisting after a write rejects", async () => {
    storeMock.writePersistedQueue.mockRejectedValueOnce(new Error("disk full"));
    getWriteListener()({}, { "1": [{ id: "a", prompt: "boom" }] });
    await flush();
    getWriteListener()({}, { "1": [{ id: "b", prompt: "recovered" }] });
    await flush();
    expect(storeMock.writePersistedQueue).toHaveBeenCalledTimes(2);
    expect(storeMock.writePersistedQueue).toHaveBeenLastCalledWith({
      "1": [{ id: "b", prompt: "recovered" }],
    });
  });
});
