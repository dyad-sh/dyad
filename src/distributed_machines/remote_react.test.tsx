import {
  StrictMode,
  createElement,
  useEffect,
  type PropsWithChildren,
} from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import { ActorHost } from "./actor_host";
import { RemoteMachineClient } from "./remote_client";
import { createRemoteMachineManifest } from "./remote_manifest";
import {
  RemoteMachineProvider,
  useDistributedMachine,
  useRemoteMachineClient,
} from "./react";
import { RemoteMachineTransport } from "./remote_transport";
import { createRemoteTestMachine, FakeDuplexRemoteTransport } from "./testing";

function createHarness() {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
  });
  const machine = createRemoteTestMachine();
  const manifest = createRemoteMachineManifest([machine]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  return { duplex, machine, transport };
}

function clientFor(
  renderer: ReturnType<FakeDuplexRemoteTransport["connect"]>,
): RemoteMachineClient {
  return new RemoteMachineClient(renderer, createSequentialIdSource());
}

describe("useDistributedMachine", () => {
  it("lets a child retain before the provider start effect", async () => {
    const { duplex, machine, transport } = createHarness();
    const client = clientFor(duplex.connect());
    let ready: "pending" | "resolved" | "rejected" = "pending";

    function Consumer() {
      const manager = useRemoteMachineClient();
      useEffect(() => {
        const lease = manager.actor(machine, "actor").retain();
        void lease.ready.then(
          () => {
            ready = "resolved";
          },
          () => {
            ready = "rejected";
          },
        );
        return lease.release;
      }, [manager]);
      return null;
    }

    const rendered = render(
      createElement(RemoteMachineProvider, { client }, createElement(Consumer)),
    );
    await waitFor(() => expect(ready).toBe("resolved"));
    expect(transport.inspectSubscriptions()).toHaveLength(1);

    rendered.unmount();
    await act(async () => Promise.resolve());
    expect(transport.inspectSubscriptions()).toHaveLength(0);
  });

  it("survives StrictMode subscription replay with one window reference", async () => {
    const { duplex, machine, transport } = createHarness();
    const client = clientFor(duplex.connect());
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        StrictMode,
        undefined,
        createElement(RemoteMachineProvider, { client }, children),
      );

    const rendered = renderHook(
      () =>
        useDistributedMachine(machine, "actor", (state) => ({
          doubled: state.value * 2,
        })),
      { wrapper },
    );
    await waitFor(() =>
      expect(rendered.result.current.connection).toBe("ready"),
    );

    expect(rendered.result.current.projection).toEqual({ doubled: 0 });
    expect(rendered.result.current.snapshot.kind).toBe("available");
    const observedRevision = rendered.result.current.observedRevision;
    expect(observedRevision).toBeDefined();
    await act(() =>
      rendered.result.current.dispatch(
        { type: "SET", value: 2 },
        { expected: observedRevision },
      ),
    );
    await waitFor(() =>
      expect(rendered.result.current.projection).toEqual({ doubled: 4 }),
    );
    await expect(
      rendered.result.current.dispatch(
        { type: "SET", value: 3 },
        { expected: observedRevision },
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({ totalReferences: 1 }),
    ]);
    rendered.unmount();
    await act(async () => Promise.resolve());
    expect(transport.inspectSubscriptions()).toEqual([]);
  });

  it("disposes a replaced provider and hydrates from the replacement window", async () => {
    const { duplex, machine, transport } = createHarness();
    const first = clientFor(duplex.connect());
    const second = clientFor(duplex.connect());
    const seen: string[] = [];

    function Consumer() {
      const actor = useDistributedMachine(machine, "actor");
      seen.push(actor.connection);
      return createElement("span", undefined, actor.state.value);
    }

    const rendered = render(
      createElement(
        RemoteMachineProvider,
        { client: first },
        createElement(Consumer),
      ),
    );
    await waitFor(() =>
      expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1),
    );
    rendered.rerender(
      createElement(
        RemoteMachineProvider,
        { client: second },
        createElement(Consumer),
      ),
    );
    await act(async () => Promise.resolve());
    await waitFor(() =>
      expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1),
    );

    expect(seen).toContain("ready");
    expect(transport.inspectSubscriptions()[0]?.windows.size).toBe(1);
  });

  it("does not rerender a hook when another actor key changes", async () => {
    const { duplex, machine } = createHarness();
    const client = clientFor(duplex.connect());
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(RemoteMachineProvider, { client }, children);
    const unrelated = client.actor(machine, "unrelated");
    const release = unrelated.subscribe(() => undefined);
    let renders = 0;
    const rendered = renderHook(
      () => {
        renders += 1;
        return useDistributedMachine(machine, "visible");
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(rendered.result.current.connection).toBe("ready"),
    );
    await waitFor(() => expect(unrelated.getStatus()).toBe("ready"));
    const before = renders;

    await act(() => unrelated.dispatch({ type: "INCREMENT" }));
    expect(unrelated.getSnapshot()).toEqual({ value: 1 });
    expect(renders).toBe(before);
    release();
  });
});
