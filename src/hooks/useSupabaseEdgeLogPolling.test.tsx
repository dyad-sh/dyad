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
import {
  EDGE_LOGS_AUTH_FAILURE_POLL_INTERVAL_MS,
  EDGE_LOGS_POLL_INTERVAL_MS,
} from "@/shared/supabase_edge_logs";

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
const CREDENTIALS = {
  accessToken: { value: "token" },
  refreshToken: { value: "refresh" },
  expiresIn: 3600,
  tokenTimestamp: 0,
};
const CONNECTED: Partial<UserSettings> = {
  supabase: { organizations: { "org-1": CREDENTIALS } },
};
const POLLING_ON: Partial<UserSettings> = {
  ...CONNECTED,
  autoFetchSupabaseEdgeFunctionLogs: true,
};

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
  mocks.getEdgeLogs.mockResolvedValue({ entries: [] });
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

    mocks.settings = POLLING_ON;
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

    mocks.settings = { ...CONNECTED, autoFetchSupabaseEdgeFunctionLogs: false };
    rerender();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 3);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });

  it("does not poll a project whose organization has no credentials", async () => {
    mocks.settings = {
      autoFetchSupabaseEdgeFunctionLogs: true,
      supabase: { organizations: { "org-2": CREDENTIALS } },
    };
    const { unmount, queryClient } = setup();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });

  it("polls less often while Supabase rejects the credentials", async () => {
    mocks.settings = POLLING_ON;
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [],
      retryFrom: NOW - 10 * 60_000,
      warning: "Reconnect your Supabase account in Settings",
      authFailed: true,
    });
    const { result, unmount, queryClient } = setup();
    await flush();
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);
    expect(result.current.edgeLogsWarning).toContain("Reconnect");

    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(1);

    // The next poll succeeds, so the normal cadence resumes.
    await flush(
      EDGE_LOGS_AUTH_FAILURE_POLL_INTERVAL_MS - EDGE_LOGS_POLL_INTERVAL_MS * 2,
    );
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(2);
    expect(result.current.edgeLogsWarning).toBeNull();
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs).toHaveBeenCalledTimes(3);
    unmount();
    queryClient.clear();
  });

  it("only polls for the selected app", async () => {
    mocks.settings = POLLING_ON;
    const { unmount, queryClient } = setup({ selectedAppId: APP_ID + 1 });
    await flush(EDGE_LOGS_POLL_INTERVAL_MS * 2);
    expect(mocks.getEdgeLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });

  it("pauses when the preview is collapsed or another tab is selected", async () => {
    mocks.settings = POLLING_ON;
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
    mocks.settings = POLLING_ON;
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [edgeEntry("old", NOW - 5 * 60_000)],
    });
    const first = setup();
    await flush();
    expect(mocks.append).toHaveBeenCalledTimes(1);
    first.unmount();

    // Hold the new fetch so the remount must first consume the cached result.
    let finish!: (result: { entries: ConsoleEntry[] }) => void;
    mocks.getEdgeLogs.mockImplementationOnce(
      () =>
        new Promise<{ entries: ConsoleEntry[] }>((resolve) => {
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
    await act(async () => finish({ entries: [] }));
    await flush();
    remount.unmount();
    first.queryClient.clear();
  });

  it("does not advance past a failed poll window", async () => {
    mocks.settings = POLLING_ON;
    mocks.getEdgeLogs.mockResolvedValueOnce({ entries: [] });
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

  it("shows partial logs immediately, retries gaps, and clears the warning on recovery", async () => {
    mocks.settings = POLLING_ON;
    const available = edgeEntry("available", NOW - 5 * 60_000);
    const recovered = edgeEntry("recovered", NOW - 7 * 60_000);
    const retryFrom = NOW - 8 * 60_000;
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [available],
      retryFrom,
      warning: "Some logs are unavailable",
    });
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [recovered, available],
    });
    const { result, unmount, queryClient } = setup();
    await flush();
    expect(mocks.append).toHaveBeenLastCalledWith(APP_ID, [available]);
    expect(result.current.edgeLogsWarning).toBe("Some logs are unavailable");

    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.getEdgeLogs.mock.calls[1][0].timestampStart).toBe(retryFrom);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append).toHaveBeenLastCalledWith(APP_ID, [recovered]);
    expect(result.current.edgeLogsWarning).toBeNull();
    unmount();
    queryClient.clear();
  });

  it("appends each log to the preview console once and not to the central store", async () => {
    mocks.settings = POLLING_ON;
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [edgeEntry("a", NOW - 1_000)],
    });
    // The next poll overlaps the first and includes a late arrival.
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [
        edgeEntry("a", NOW - 1_000),
        edgeEntry("late", NOW - 3_000),
        edgeEntry("b", NOW + 4_000),
      ],
    });
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
    mocks.getEdgeLogs.mockResolvedValueOnce({
      entries: [edgeEntry("b", NOW + 4_000)],
    });
    await flush(EDGE_LOGS_POLL_INTERVAL_MS);
    expect(mocks.append).toHaveBeenCalledTimes(2);

    await flush(1_000);
    expect(mocks.addLogs).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });
});
