import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import { AppLogForwarder } from "./app_log_forwarder";
import { MAX_LOGS_PER_APP } from "./log_store";

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: { misc: { addLogs: vi.fn() } },
}));

function entry(message: string): ConsoleEntry {
  return {
    level: "info",
    type: "client",
    message,
    timestamp: 0,
    appId: 1,
  };
}

describe("AppLogForwarder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends entries enqueued within the flush delay as one batch", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const forwarder = new AppLogForwarder(send, 100);

    for (let i = 0; i < 500; i++) {
      forwarder.enqueue([entry(`m${i}`)]);
    }
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(500);
    expect(send.mock.calls[0][0][0].message).toBe("m0");
  });

  it("starts a new batch after a flush", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const forwarder = new AppLogForwarder(send, 100);

    forwarder.enqueue([entry("a")]);
    await vi.advanceTimersByTimeAsync(100);
    forwarder.enqueue([entry("b")]);
    await vi.advanceTimersByTimeAsync(100);

    expect(send.mock.calls.map(([entries]) => entries[0].message)).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps only the newest MAX_LOGS_PER_APP entries between flushes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const forwarder = new AppLogForwarder(send, 100);

    const total = MAX_LOGS_PER_APP + 250;
    for (let i = 0; i < total; i++) {
      forwarder.enqueue([entry(`m${i}`)]);
    }
    await vi.advanceTimersByTimeAsync(100);

    const sent: ConsoleEntry[] = send.mock.calls[0][0];
    expect(sent).toHaveLength(MAX_LOGS_PER_APP);
    expect(sent[0].message).toBe("m250");
    expect(sent.at(-1)?.message).toBe(`m${total - 1}`);
  });

  it("does not throw when sending fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => {
      throw new Error("no handler");
    });
    const forwarder = new AppLogForwarder(send, 100);

    forwarder.enqueue([entry("a")]);
    await vi.advanceTimersByTimeAsync(100);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
