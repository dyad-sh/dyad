import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queryKeys";
import type { CoolifySetupState } from "@/coolify_setup/state";

const listeners = vi.hoisted(
  () => ({ current: [] }) as { current: ((state: unknown) => void)[] },
);
const snapshot = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/types", () => ({
  ipc: {
    coolifySetup: { snapshot },
    events: {
      coolifySetup: {
        onChanged: (fn: (state: unknown) => void) => {
          listeners.current.push(fn);
          return () => {
            listeners.current = listeners.current.filter((x) => x !== fn);
          };
        },
      },
    },
  },
}));

const { useCoolifySetupSnapshot } = await import("./useCoolifySetupSnapshot");

const RUNNING: CoolifySetupState = {
  type: "running",
  host: "203.0.113.5",
  invocationRef: {
    kind: "coolify-setup",
    entityKey: "203.0.113.5",
    operationId: "op-1",
  },
  step: "installing",
  log: "",
  stopping: false,
};

function push(state: unknown) {
  act(() => {
    for (const fn of listeners.current) fn(state);
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

/**
 * How many times the status query has been read.
 *
 * A run writes the account in the main process, so the status this panel
 * already holds is stale from that moment — and staleTime keeps it. Counting
 * reads is the only way to tell a refresh from a value that merely looks
 * right because the test seeded it that way.
 */
function trackStatus() {
  const calls = { count: 0 };
  const useStatus = () =>
    useQuery({
      queryKey: queryKeys.coolify.status({ appId: 1 }),
      queryFn: () => {
        calls.count += 1;
        return Promise.resolve({ serverUrl: "http://203.0.113.5:8000" });
      },
      // As the panel holds it: read once, then kept until something says
      // otherwise. Without this the refetch below would prove nothing.
      staleTime: 60_000,
    });
  return { calls, useStatus };
}

beforeEach(() => {
  listeners.current = [];
  snapshot.mockReset();
  snapshot.mockResolvedValue({ type: "idle" });
});

describe("when a run settles", () => {
  it("refreshes what the rest of the panel knows about this Coolify", async () => {
    // The account is written partway through a run, in the main process. The
    // only refresh was on the way out of the finished screen, which a failure
    // never reaches, so the panel went on believing there was no server —
    // and hid the sign-out that the refusal to install again asks for.
    const { Wrapper } = makeWrapper();
    const { calls, useStatus } = trackStatus();
    renderHook(
      () => {
        useCoolifySetupSnapshot();
        useStatus();
      },
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(calls.count).toBe(1));

    push(RUNNING);
    // Nothing is written until a run settles, so nothing is stale yet.
    expect(calls.count).toBe(1);

    push({
      type: "failed",
      host: "203.0.113.5",
      message: "boom",
      cancelled: false,
    });
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it("refreshes it after one that finished, too", async () => {
    const { Wrapper } = makeWrapper();
    const { calls, useStatus } = trackStatus();
    renderHook(
      () => {
        useCoolifySetupSnapshot();
        useStatus();
      },
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(calls.count).toBe(1));

    push({ type: "done", host: "203.0.113.5", result: { dashboardUrl: "x" } });

    await waitFor(() => expect(calls.count).toBe(2));
  });
});
