import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { change } from "@/state_machines/types";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { ActorHost } from "./actor_host";
import type { DistributedMachineDefinition } from "./definition";
import { useActorSelector } from "./react";

describe("useActorSelector", () => {
  it("selects from a local actor ref without rerendering equal selections", () => {
    const definition: DistributedMachineDefinition<
      "selector-machine",
      string,
      { readonly value: number },
      { readonly type: "SET"; readonly value: number },
      never,
      never
    > = {
      id: "selector-machine",
      host: "renderer",
      initialState: () => ({ value: 0 }),
      transition: (_state, event) => change({ value: event.value }),
      createScheduler: () => ({ schedule: () => undefined }),
      createCommandRunner: () => () => undefined,
      lifecycle: {
        subscriptionCreates: true,
        dispatchCreates: true,
        idleEviction: { kind: "retain" },
        terminalRetention: { kind: "retain" },
        entityDeletion: "dispose",
        rendererOwnership: "window",
        survivesRendererReload: false,
        restartPersistence: "ephemeral",
        flushOnShutdown: false,
      },
    };
    const host = new ActorHost({
      placement: "renderer",
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
    });
    host.register(definition);
    const actor = host.localRef(definition, "key");
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useActorSelector(actor, (state) => state.value % 2);
    });

    act(() => actor.send({ type: "SET", value: 2 }));
    expect(result.current).toBe(0);
    expect(renders).toBe(1);

    act(() => actor.send({ type: "SET", value: 3 }));
    expect(result.current).toBe(1);
    expect(renders).toBe(2);
  });
});
