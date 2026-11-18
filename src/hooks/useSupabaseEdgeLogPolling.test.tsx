import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import type { ConsoleEntry } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import { EDGE_LOGS_POLL_INTERVAL_MS } from "@/shared/supabase_edge_logs";

const mocks = vi.hoisted(() => ({
  settings: {} as Partial<UserSettings>,
  getEdgeLogs: vi.fn(),
  addLogs: vi.fn(),
  append: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    supabase: {
      getEdgeLogs: mocks.getEdgeLogs,
      listOrganizations: vi.fn(async () => []),
      listAllProjects: vi.fn(async () => []),
    },
    misc: { addLogs: mocks.addLogs },
    events: { supabase: { onRedeployProgress: () => () => {} } },
  },
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("@/app_run/AppRunRemoteProvider", () => ({
  useAppRunRemoteManager: () => ({ previewConsole: { append: mocks.append } }),
}));

import { useSupabase } from "./useSupabase";

const APP_ID = 3;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

function edgeEntry(id: string, timestamp: number): ConsoleEntry {
  return {
    level: "info",
    type: "edge-function",
    message: `log ${id}`,
    timestamp,
    appId: APP_ID,
    providerLogId: id,
  };
}

function setup({ selectedAppId = APP_ID } = {}) {
  const store = createStore();
  store.set(selectedAppIdAtom, selectedAppId);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
  const view = renderHook(
    () =>
      useSupabase({
        edgeLogsProjectId: "proj-1",
        edgeLogsOrganizationSlug: "org-1",
        edgeLogsAppId: APP_ID,
      }),
    { wrapper },
  );
  return { ...view, queryClient, store, wrapper };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // React Query delivers results through batched timers scheduled after
    // the fetch settles; give them a moment (well under a poll interval).
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.settings = {};
  mocks.getEdgeLogs.mockResolvedValue([]);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("useSupabase edge log polling", () => {
  it("does not fetch by default: not on mount, ticks, focus or reconnect", async () => {
    const { unmount, queryClient } = setup();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 3);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });

  it("starts and stops polling when the setting changes, without a restart", async () => {
    const { rerender, unmount, queryClient } = setup();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs).not.toHaveBeenCalled();

    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    const enabledAt = Date.now();
    rerender();
    await flush();
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);
    expect(mocks.getEdgeLogs).toHaveBeenLastCalledWith({
      projectId: "proj-1",
      appId: APP_ID,
      organizationSlug: "org-1",
      timestampStart: enabledAt - 10 * 60_000,
    });

    // Same cadence as before.
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);

    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: false };
    rerender();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 3);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });

  it("only polls for the selected app", async () => {
    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    const { unmount, queryClient } = setup({ selectedAppId: APP_ID + 1 });
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });

  it("pauses when the preview is collapsed or another tab is selected", async () => {
    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    const { store, unmount, queryClient } = setup();
    await flush();
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);

    act(() => store.set(isPreviewOpenAtom, false));
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);

    act(() => {
      store.set(previewModeAtom, "code");
      store.set(isPreviewOpenAtom, true);
    });
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);

    act(() => store.set(previewModeAtom, "preview"));
    await flush();
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });

  it("does not append older cached logs when the preview remounts", async () => {
    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    mocks.getEdgeLogs.mockResolvedValueOnce([
      edgeEntry("old", NOW - 5 * 60_000),
    ]);
    const first = setup();
    await flush();
    expect(mocks.append).toHaveBeenCalledTimes(1);
    first.unmount();

    // Hold the new fetch so the remount must first consume the cached result.
    let finish!: (entries: ConsoleEntry[]) => void;
    mocks.getEdgeLogs.mockImplementationOnce(
      () =>
        new Promise<ConsoleEntry[]>((resolve) => {
          finish = resolve;
        }),
    );
    const remount = renderHook(
      () =>
        useSupabase({
          edgeLogsProjectId: "proj-1",
          edgeLogsOrganizationSlug: "org-1",
          edgeLogsAppId: APP_ID,
        }),
      { wrapper: first.wrapper, reactStrictMode: true },
    );
    await flush();
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    await act(async () => finish([]));
    await flush();
    remount.unmount();
    first.queryClient.clear();
  });

  it("does not advance past a failed poll window", async () => {
    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    mocks.getEdgeLogs.mockResolvedValueOnce([]);
    mocks.getEdgeLogs.mockRejectedValueOnce(new Error("Incomplete logs"));
    const { unmount, queryClient } = setup();
    await flush();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    const failedStart = mocks.getEdgeLogs.mock.calls[1][0].timestampStart;
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs.mock.calls[2][0].timestampStart).toBe(failedStart);
    unmount();
    queryClient.clear();
  });

  it("appends each log to the preview console once and not to the central store", async () => {
    mocks.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
    mocks.getEdgeLogs.mockResolvedValueOnce([edgeEntry("a", NOW - 1_000)]);
    // The next poll overlaps the first and includes a late arrival.
    mocks.getEdgeLogs.mockResolvedValueOnce([
      edgeEntry("a", NOW - 1_000),
      edgeEntry("late", NOW - 3_000),
      edgeEntry("b", NOW + 4_000),
    ]);
    const { unmount, queryClient } = setup();
    await flush();
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.append).toHaveBeenLastCalledWith(APP_ID, [
      edgeEntry("a", NOW - 1_000),
    ]);

    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    // The second poll re-reads the recent overlap.
    expect(mocks.getEdgeLogs.mock.calls[1][0].timestampStart).toBe(
      NOW - 2 * 60_000,
    );
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append).toHaveBeenLastCalledWith(APP_ID, [
      edgeEntry("late", NOW - 3_000),
      edgeEntry("b", NOW + 4_000),
    ]);

    // A poll that only returns known logs appends nothing.
    mocks.getEdgeLogs.mockResolvedValueOnce([edgeEntry("b", NOW + 4_000)]);
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.append).toHaveBeenCalledTimes(2);

    await flush(1_000);
    expect(mocks.addLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });
});
