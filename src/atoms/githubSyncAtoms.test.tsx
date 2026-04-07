import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";

import {
  DEFAULT_GITHUB_SYNC_STATE,
  useGithubSyncState,
} from "@/atoms/githubSyncAtoms";

// Returns a wrapper bound to a fresh Jotai store so tests are isolated and
// sibling `renderHook` calls in the same test share the same store (modeling
// the production app which has a single global store).
function makeWrapper() {
  const store = createStore();
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useGithubSyncState", () => {
  it("returns the default state when no app has synced yet", () => {
    const { result } = renderHook(() => useGithubSyncState(1), {
      wrapper: makeWrapper(),
    });

    expect(result.current[0]).toEqual(DEFAULT_GITHUB_SYNC_STATE);
  });

  it("preserves sync state across unmount/remount for the same appId", () => {
    // This is the regression test for the navigation-mid-sync bug: when the
    // user leaves the Publish tab while a push is running, the component
    // unmounts. When they return, the re-mounted component must still show
    // the in-flight / completed state.
    const wrapper = makeWrapper();

    const first = renderHook(() => useGithubSyncState(42), { wrapper });

    act(() => {
      first.result.current[1]({ isSyncing: true });
    });
    expect(first.result.current[0].isSyncing).toBe(true);

    first.unmount();

    const second = renderHook(() => useGithubSyncState(42), { wrapper });
    // Without the atom, this would be `false` (fresh local state).
    expect(second.result.current[0].isSyncing).toBe(true);

    // Completing the push after remount should update the new hook instance.
    act(() => {
      second.result.current[1]({ isSyncing: false, syncSuccess: true });
    });
    expect(second.result.current[0].isSyncing).toBe(false);
    expect(second.result.current[0].syncSuccess).toBe(true);
  });

  it("completes a push while the component is unmounted and shows the result on remount", () => {
    // Models the exact bug scenario: a push is in flight, the user navigates
    // away (component unmounts), the IPC completion handler still runs and
    // writes to the atom, and on remount the success is visible.
    const wrapper = makeWrapper();

    const first = renderHook(() => useGithubSyncState(7), { wrapper });
    // Capture the stable setter from the first mount (this is what the
    // unmounted async handler would hold on to).
    const updaterFromFirstMount = first.result.current[1];

    act(() => {
      updaterFromFirstMount({ isSyncing: true });
    });

    first.unmount();

    // While the component is unmounted, the background IPC completes and
    // writes to the atom via the stale setter captured above.
    act(() => {
      updaterFromFirstMount({ isSyncing: false, syncSuccess: true });
    });

    const second = renderHook(() => useGithubSyncState(7), { wrapper });
    expect(second.result.current[0]).toEqual({
      ...DEFAULT_GITHUB_SYNC_STATE,
      isSyncing: false,
      syncSuccess: true,
    });
  });

  it("isolates state between different appIds", () => {
    const wrapper = makeWrapper();

    const appA = renderHook(() => useGithubSyncState(1), { wrapper });
    const appB = renderHook(() => useGithubSyncState(2), { wrapper });

    act(() => {
      appA.result.current[1]({ isSyncing: true, syncError: "oops" });
    });

    expect(appA.result.current[0].isSyncing).toBe(true);
    expect(appA.result.current[0].syncError).toBe("oops");
    // App B should be untouched.
    expect(appB.result.current[0]).toEqual(DEFAULT_GITHUB_SYNC_STATE);
  });

  it("no-ops when appId is null", () => {
    const { result } = renderHook(() => useGithubSyncState(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current[0]).toEqual(DEFAULT_GITHUB_SYNC_STATE);

    act(() => {
      result.current[1]({ isSyncing: true });
    });

    // Still default — a null appId cannot own any persistent state.
    expect(result.current[0]).toEqual(DEFAULT_GITHUB_SYNC_STATE);
  });
});
