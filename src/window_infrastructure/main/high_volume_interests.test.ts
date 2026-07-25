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
});
