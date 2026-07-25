import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WindowSessionId } from "../types";
import { HighVolumeWindowInterests } from "./high_volume_interests";
import { WindowRegistry, type WindowEndpoint } from "./window_registry";

function endpoint(id: number) {
  let onDestroyed: (() => void) | undefined;
  const value: WindowEndpoint & { destroy(): void } = {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
    once: (_event, listener) => {
      onDestroyed = listener;
    },
    destroy: () => onDestroyed?.(),
  };
  return value;
}

describe("HighVolumeWindowInterests", () => {
  it("closes the attach race, batches per destination, and cleans up", async () => {
    const registry = new WindowRegistry();
    const first = endpoint(1);
    const second = endpoint(2);
    registry.register(first, randomUUID() as WindowSessionId);
    registry.register(second, randomUUID() as WindowSessionId);
    const interests = new HighVolumeWindowInterests<string>(
      registry,
      "output",
      1_000,
    );
    const interest = { kind: "app-output" as const, appId: 7 };
    let releaseBootstrap!: (value: readonly string[]) => void;
    const bootstrap = new Promise<readonly string[]>((resolve) => {
      releaseBootstrap = resolve;
    });
    const attaching = interests.attach(1, interest, () => bootstrap);
    interests.enqueue(interest, "live-during-bootstrap");
    releaseBootstrap(["bootstrap"]);
    await attaching;
    expect(first.send).toHaveBeenCalledWith("output", [
      "bootstrap",
      "live-during-bootstrap",
    ]);

    await interests.attach(2, interest, () => []);
    interests.enqueue(interest, "one");
    interests.enqueue(interest, "two");
    interests.terminalFlush(interest);
    expect(first.send).toHaveBeenLastCalledWith("output", ["one", "two"]);
    expect(second.send).toHaveBeenLastCalledWith("output", ["one", "two"]);

    first.destroy();
    expect(interests.inspect(1)).toEqual([]);
  });

  it("does not deliver a stale bootstrap after detach or replacement", async () => {
    const registry = new WindowRegistry();
    const renderer = endpoint(1);
    registry.register(renderer, randomUUID() as WindowSessionId);
    const interests = new HighVolumeWindowInterests<string>(
      registry,
      "output",
      1_000,
    );
    const interest = { kind: "app-output" as const, appId: 7 };
    let releaseFirst!: (value: readonly string[]) => void;
    const firstBootstrap = new Promise<readonly string[]>((resolve) => {
      releaseFirst = resolve;
    });

    const staleAttach = interests.attach(1, interest, () => firstBootstrap);
    interests.detach(1, interest);
    await interests.attach(1, interest, () => ["replacement"]);
    releaseFirst(["stale"]);
    await staleAttach;

    expect(renderer.send).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledWith("output", ["replacement"]);
  });

  it("rolls back a failed bootstrap without wedging later delivery", async () => {
    const registry = new WindowRegistry();
    const renderer = endpoint(1);
    registry.register(renderer, randomUUID() as WindowSessionId);
    const interests = new HighVolumeWindowInterests<string>(
      registry,
      "output",
      1_000,
    );
    const interest = { kind: "chat-chunk" as const, chatId: 9 };

    await expect(
      interests.attach(1, interest, () =>
        Promise.reject(new Error("bootstrap failed")),
      ),
    ).rejects.toThrow("bootstrap failed");
    expect(interests.inspect(1)).toEqual([]);

    await interests.attach(1, interest, () => ["recovered"]);
    interests.enqueue(interest, "live");
    interests.terminalFlush(interest);
    expect(renderer.send).toHaveBeenNthCalledWith(1, "output", ["recovered"]);
    expect(renderer.send).toHaveBeenNthCalledWith(2, "output", ["live"]);
  });

  it("discards queued payloads from a replaced subscription generation", async () => {
    const registry = new WindowRegistry();
    const renderer = endpoint(1);
    registry.register(renderer, randomUUID() as WindowSessionId);
    const interests = new HighVolumeWindowInterests<string>(
      registry,
      "output",
      1_000,
    );
    const interest = { kind: "app-output" as const, appId: 7 };

    await interests.attach(1, interest, () => []);
    interests.enqueue(interest, "superseded-pending");
    await interests.attach(1, interest, () => ["replacement-bootstrap"]);
    interests.flushAll();

    expect(renderer.send).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledWith("output", [
      "replacement-bootstrap",
    ]);
  });
});
