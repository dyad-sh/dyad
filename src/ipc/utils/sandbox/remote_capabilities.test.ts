import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createRemoteCallDispatcher,
  createRemoteCapabilityProxies,
  type RemoteCapabilityMap,
} from "./remote_capabilities";
import type {
  SandboxHostMessage,
  SandboxRemoteCallMessage,
} from "./worker_protocol";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wires a worker-side proxy set to a main-side dispatcher over a real
 * MessageChannel, so messages are structured-cloned and delivered
 * asynchronously exactly as they are between a worker and its parent.
 */
function createBridge(capabilities: RemoteCapabilityMap, names?: string[]) {
  const channel = new MessageChannel();
  const dispatcher = createRemoteCallDispatcher(capabilities, (message) =>
    channel.port1.postMessage(message),
  );
  channel.port1.on("message", (message: SandboxRemoteCallMessage) => {
    void dispatcher.dispatch(message);
  });
  const proxies = createRemoteCapabilityProxies(
    names ?? Object.keys(capabilities),
    (message) => channel.port2.postMessage(message),
  );
  channel.port2.on("message", (message: SandboxHostMessage) => {
    proxies.receive(message);
  });
  return {
    proxies,
    dispatcher,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

describe("sandbox remote capability bridge", () => {
  const bridges: Array<{ close: () => void }> = [];
  afterEach(() => {
    for (const bridge of bridges.splice(0)) {
      bridge.close();
    }
  });

  it("forwards arguments to the main-side capability and returns its result", async () => {
    const calls: unknown[][] = [];
    const bridge = createBridge({
      write_file: async (...args: unknown[]) => {
        calls.push(args);
        return `wrote ${String(args[0])}`;
      },
    });
    bridges.push(bridge);

    await expect(
      bridge.proxies.capabilities.write_file("src/a.txt", "hello", "note"),
    ).resolves.toBe("wrote src/a.txt");
    expect(calls).toEqual([["src/a.txt", "hello", "note"]]);
    expect(bridge.proxies.pendingCount).toBe(0);
    expect(bridge.dispatcher.inFlightCount).toBe(0);
  });

  it("preserves DyadError kinds across the boundary", async () => {
    const bridge = createBridge({
      write_file: async () => {
        throw new DyadError("Consent denied", DyadErrorKind.UserCancelled);
      },
      mcp__tool: async () => {
        throw new Error("plain failure");
      },
    });
    bridges.push(bridge);

    await expect(
      bridge.proxies.capabilities.write_file("src/a.txt", "x"),
    ).rejects.toMatchObject({
      message: "Consent denied",
      kind: DyadErrorKind.UserCancelled,
    });
    const plain = await (
      bridge.proxies.capabilities.mcp__tool() as Promise<unknown>
    ).catch((error: unknown) => error);
    expect(plain).toBeInstanceOf(Error);
    expect(plain).not.toBeInstanceOf(DyadError);
    expect((plain as Error).message).toBe("plain failure");
  });

  it("correlates interleaved calls that resolve out of order", async () => {
    const bridge = createBridge({
      slow: async (value: unknown) => {
        await delay(30);
        return `slow:${String(value)}`;
      },
      fast: async (value: unknown) => `fast:${String(value)}`,
    });
    bridges.push(bridge);

    const results = await Promise.all([
      bridge.proxies.capabilities.slow(1),
      bridge.proxies.capabilities.fast(2),
      bridge.proxies.capabilities.slow(3),
      bridge.proxies.capabilities.fast(4),
    ]);

    expect(results).toEqual(["slow:1", "fast:2", "slow:3", "fast:4"]);
    expect(bridge.proxies.pendingCount).toBe(0);
  });

  it("rejects a call to a name the main side does not serve", async () => {
    // The worker only proxies names the runner advertised, but a stale or
    // hand-built message must still get a reply rather than hang.
    const bridge = createBridge({}, ["ghost"]);
    bridges.push(bridge);

    await expect(bridge.proxies.capabilities.ghost()).rejects.toMatchObject({
      message: "Unknown sandbox host function: ghost",
      kind: DyadErrorKind.Internal,
    });
  });

  it("does not let a prototype property pass as a capability", async () => {
    const bridge = createBridge({}, ["toString", "constructor"]);
    bridges.push(bridge);

    await expect(bridge.proxies.capabilities.toString()).rejects.toMatchObject({
      kind: DyadErrorKind.Internal,
    });
    await expect(
      bridge.proxies.capabilities.constructor(),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Internal });
  });

  it("reports a result that cannot cross the boundary as the call's error", async () => {
    const bridge = createBridge({
      handle: async () => ({ fn: () => 1 }),
    });
    bridges.push(bridge);

    await expect(bridge.proxies.capabilities.handle()).rejects.toMatchObject({
      kind: DyadErrorKind.Internal,
      message: expect.stringContaining("cannot cross the worker boundary"),
    });
    expect(bridge.dispatcher.inFlightCount).toBe(0);
  });

  it("reports an argument that cannot cross the boundary without posting", async () => {
    const posted: SandboxRemoteCallMessage[] = [];
    const proxies = createRemoteCapabilityProxies(["echo"], (message) => {
      posted.push(message);
      // Mimic structuredClone's failure on a function argument.
      if (message.args.some((arg) => typeof arg === "function")) {
        throw new Error("could not be cloned");
      }
    });

    await expect(proxies.capabilities.echo(() => 1)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(posted).toHaveLength(1);
    expect(proxies.pendingCount).toBe(0);
  });

  it("rejects in-flight calls on dispose and ignores late replies", async () => {
    const proxies = createRemoteCapabilityProxies(["echo"], () => {});

    const pending = proxies.capabilities.echo("x");
    expect(proxies.pendingCount).toBe(1);
    proxies.dispose();

    await expect(pending).rejects.toMatchObject({
      kind: DyadErrorKind.Internal,
      message: expect.stringContaining("abandoned"),
    });
    expect(proxies.pendingCount).toBe(0);
    expect(
      proxies.receive({ type: "remoteResult", callId: 1, value: "late" }),
    ).toBe(true);
    expect(proxies.receive({ type: "vmBudgetPause" })).toBe(false);
    expect(proxies.receive(null)).toBe(false);
  });
});
