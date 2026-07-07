// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createIpcSuccessEnvelope } from "@/ipc/contracts/core";
import {
  installRendererIpcBridge,
  type RendererIpcBridge,
} from "./renderer_ipc_bridge";
import type { ElectronMockShared } from "./electron_mock";

type TestIpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  invokeEnvelope: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
};

function createBridge(options?: { validateChannels?: boolean }): {
  bridge: RendererIpcBridge;
  shared: ElectronMockShared;
  ipcRenderer: TestIpcRenderer;
} {
  const shared: ElectronMockShared = { ipcHandlers: new Map() };
  // These unit tests exercise bridge mechanics with synthetic channel names,
  // so channel validation (on by default, mirroring preload) is opted out
  // unless a test asks for it.
  const bridge = installRendererIpcBridge(shared, {
    validateChannels: options?.validateChannels ?? false,
  });
  const ipcRenderer = (
    window as unknown as { electron: { ipcRenderer: TestIpcRenderer } }
  ).electron.ipcRenderer;
  return { bridge, shared, ipcRenderer };
}

describe("installRendererIpcBridge", () => {
  let bridge: RendererIpcBridge | undefined;

  afterEach(() => {
    bridge?.uninstall();
    bridge = undefined;
    vi.restoreAllMocks();
  });

  it("resolves once from send dispatch for the next matching event", async () => {
    const setup = createBridge();
    bridge = setup.bridge;

    const nextMatch = bridge.once(
      "chat:response:end",
      (event) =>
        !!event.args[0] &&
        typeof event.args[0] === "object" &&
        (event.args[0] as { chatId?: number }).chatId === 2,
    );

    bridge.send("chat:response:end", { chatId: 1 });
    await expect(
      Promise.race([
        nextMatch.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
    ).resolves.toBe("pending");

    bridge.send("other:event", { chatId: 2 });
    bridge.send("chat:response:end", { chatId: 2 }, "extra");

    await expect(nextMatch).resolves.toEqual({
      channel: "chat:response:end",
      args: [{ chatId: 2 }, "extra"],
    });
    expect(bridge.eventCount("chat:response:end")).toBe(2);
    expect(bridge.sentEvents.map((event) => event.channel)).toEqual([
      "chat:response:end",
      "other:event",
      "chat:response:end",
    ]);
  });

  it("logs raw invoke results while preserving invoke unwrap behavior", async () => {
    const setup = createBridge();
    bridge = setup.bridge;
    const { shared, ipcRenderer } = setup;

    shared.ipcHandlers.set("wrapped", (_event, input) =>
      createIpcSuccessEnvelope({ input }),
    );

    await expect(ipcRenderer.invoke("wrapped", { value: 42 })).resolves.toEqual(
      { input: { value: 42 } },
    );

    const invokeEntry = bridge.lastInvoke("wrapped");
    expect(invokeEntry).toMatchObject({
      channel: "wrapped",
      args: [{ value: 42 }],
      status: "fulfilled",
      result: createIpcSuccessEnvelope({ input: { value: 42 } }),
    });
    expect(invokeEntry?.settledAt).toEqual(expect.any(Number));

    const rawEnvelope = await ipcRenderer.invokeEnvelope("wrapped", {
      value: "raw",
    });

    expect(rawEnvelope).toEqual(
      createIpcSuccessEnvelope({ input: { value: "raw" } }),
    );
    expect(bridge.lastInvoke("wrapped")?.result).toEqual(rawEnvelope);
    expect(bridge.invokeLog).toHaveLength(2);
  });

  it("records missing handler failures in missingChannels and invokeLog", async () => {
    const setup = createBridge();
    bridge = setup.bridge;

    await expect(
      setup.ipcRenderer.invokeEnvelope("missing:channel", { id: 123 }),
    ).rejects.toThrow(
      "[renderer-ipc-bridge] no ipcMain handler registered for 'missing:channel'",
    );

    expect([...bridge.missingChannels]).toEqual(["missing:channel"]);
    const entry = bridge.lastInvoke("missing:channel");
    expect(entry).toMatchObject({
      channel: "missing:channel",
      args: [{ id: 123 }],
      status: "rejected",
    });
    expect(entry?.error).toBeInstanceOf(Error);
    expect(entry?.settledAt).toEqual(expect.any(Number));
  });

  it("throws with pending channels when settleInFlight times out", async () => {
    const setup = createBridge();
    bridge = setup.bridge;

    setup.shared.ipcHandlers.set("never:settles", () => new Promise(() => {}));

    void setup.ipcRenderer.invokeEnvelope("never:settles");
    await expect(bridge.settleInFlight(1)).rejects.toThrow(
      /settleInFlight timed out.*never:settles/s,
    );
    expect(bridge.pendingCount).toBe(1);
  });

  it("enforces the preload channel whitelist when validation is on", async () => {
    const setup = createBridge({ validateChannels: true });
    bridge = setup.bridge;
    const { shared, ipcRenderer } = setup;

    // A handler for a channel outside the contract-derived whitelist: works
    // main-side, but the renderer bridge must reject it like preload does.
    shared.ipcHandlers.set("rogue:channel", () => "ok");
    expect(() => ipcRenderer.invoke("rogue:channel")).toThrow(
      "Invalid channel: rogue:channel",
    );
    expect(() => ipcRenderer.on("rogue:event", () => {})).toThrow(
      "Invalid channel: rogue:event",
    );

    // Whitelisted channels pass validation; a missing handler is still a
    // rejection collected in missingChannels (not a whitelist error).
    await expect(ipcRenderer.invoke("chat:cancel", 1)).rejects.toThrow(
      "no ipcMain handler registered for 'chat:cancel'",
    );
    expect([...bridge.missingChannels]).toEqual(["chat:cancel"]);
  });

  it("structured-clones across the fake process boundary like real IPC", async () => {
    const setup = createBridge();
    bridge = setup.bridge;
    const { shared, ipcRenderer } = setup;

    // Non-cloneable result: real invoke would reject ("An object could not be
    // cloned"); the bridge must too.
    shared.ipcHandlers.set("returns:function", () => ({ cb: () => {} }));
    await expect(ipcRenderer.invoke("returns:function")).rejects.toThrow(
      /not structured-cloneable/,
    );

    // Cloned args: the handler mutating its input must not alias the
    // renderer's object.
    const rendererArg = { nested: { value: 1 } };
    shared.ipcHandlers.set("mutates:input", (_event, input) => {
      (input as { nested: { value: number } }).nested.value = 999;
      return "done";
    });
    await expect(
      ipcRenderer.invoke("mutates:input", rendererArg),
    ).resolves.toBe("done");
    expect(rendererArg.nested.value).toBe(1);

    // Cloned event payloads: main mutating a sent payload after the fact must
    // not change what the renderer recorded.
    const payload = { status: "before" };
    bridge.send("some:event", payload);
    payload.status = "after";
    expect(bridge.sentEvents[0].args[0]).toEqual({ status: "before" });
  });

  it("keeps draining when an in-flight handler dispatch schedules another invoke", async () => {
    const setup = createBridge();
    bridge = setup.bridge;
    const { shared, ipcRenderer } = setup;

    shared.ipcHandlers.set("first", (event) => {
      (
        event as {
          sender: { send: (channel: string, ...args: unknown[]) => void };
        }
      ).sender.send("schedule:second");
      return "first-result";
    });
    shared.ipcHandlers.set("second", () => Promise.resolve("second-result"));

    const unsubscribe = ipcRenderer.on("schedule:second", () => {
      void ipcRenderer.invokeEnvelope("second");
    });

    void ipcRenderer.invokeEnvelope("first");
    await bridge.settleInFlight();

    expect(bridge.lastInvoke("first")).toMatchObject({
      status: "fulfilled",
      result: "first-result",
    });
    expect(bridge.lastInvoke("second")).toMatchObject({
      status: "fulfilled",
      result: "second-result",
    });
    expect(bridge.pendingCount).toBe(0);

    unsubscribe();
  });
});
