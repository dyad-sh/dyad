import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => {
  let phase = "streaming";
  return {
    reset: () => {
      phase = "streaming";
    },
    getSnapshot: vi.fn(() => ({
      phase,
      active: null,
    })),
    subscribe: vi.fn((_listener: () => void) => {
      // Reproduce settlement in the read-to-subscribe gap without delivering
      // a notification to the newly registered listener.
      phase = "idle";
      return vi.fn();
    }),
    send: vi.fn(),
  };
});

vi.mock("@/ipc/services/distributed_machine_actor_host", () => ({
  remoteMachineHost: {
    localRef: () => actor,
  },
}));

vi.mock("@/chat_stream/definition", () => ({
  chatStreamDefinition: {},
}));

import { waitForChatActorIdle } from "./chat_actor_service";

describe("waitForChatActorIdle", () => {
  beforeEach(() => {
    actor.reset();
    actor.getSnapshot.mockClear();
    actor.subscribe.mockClear();
  });

  it("rechecks the terminal phase after subscribing", async () => {
    await expect(waitForChatActorIdle(7)).resolves.toBeUndefined();
    expect(actor.subscribe).toHaveBeenCalledOnce();
    expect(actor.getSnapshot).toHaveBeenCalledTimes(2);
  });
});
