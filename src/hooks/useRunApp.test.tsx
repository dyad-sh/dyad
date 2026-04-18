import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appConsoleEntriesAtom,
  previewErrorMessageAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAppOutputSubscription } from "@/hooks/useRunApp";

const {
  addLogMock,
  appOutputBatchListeners,
  appOutputListeners,
  respondToAppInputMock,
  showErrorMock,
  showInputRequestMock,
} = vi.hoisted(() => ({
  addLogMock: vi.fn(),
  appOutputBatchListeners: new Set<(outputs: unknown[]) => void>(),
  appOutputListeners: new Set<(output: unknown) => void>(),
  respondToAppInputMock: vi.fn(),
  showErrorMock: vi.fn(),
  showInputRequestMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      respondToAppInput: respondToAppInputMock,
    },
    misc: {
      addLog: addLogMock,
    },
    events: {
      misc: {
        onAppOutput: (listener: (output: unknown) => void) => {
          appOutputListeners.add(listener);
          return () => appOutputListeners.delete(listener);
        },
        onAppOutputBatch: (listener: (outputs: unknown[]) => void) => {
          appOutputBatchListeners.add(listener);
          return () => appOutputBatchListeners.delete(listener);
        },
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
  showInputRequest: showInputRequestMock,
}));

function makeWrapper(appId: number) {
  const store = createStore();
  store.set(selectedAppIdAtom, appId);

  return {
    store,
    Wrapper({ children }: PropsWithChildren) {
      return <Provider store={store}>{children}</Provider>;
    },
  };
}

describe("useAppOutputSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addLogMock.mockReset();
    appOutputListeners.clear();
    appOutputBatchListeners.clear();
    respondToAppInputMock.mockReset();
    showErrorMock.mockReset();
    showInputRequestMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows throttled sync failure toasts and clears sync errors after recovery", () => {
    const { store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    expect(appOutputListeners.size).toBe(1);
    expect(appOutputBatchListeners.size).toBe(1);

    const emitOutput = (output: {
      type: string;
      message: string;
      appId: number;
    }) => {
      act(() => {
        for (const listener of appOutputListeners) {
          listener(output);
        }
      });
    };

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });

    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(store.get(previewErrorMessageAtom)).toEqual({
      message: "Cloud sandbox sync failed: network down",
      source: "dyad-sync",
    });
    expect(store.get(appConsoleEntriesAtom)).toHaveLength(1);

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });

    expect(showErrorMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });

    expect(showErrorMock).toHaveBeenCalledTimes(2);

    emitOutput({
      type: "sync-recovered",
      message:
        "Cloud sandbox sync recovered. Local changes are uploading again.",
      appId: 1,
    });

    expect(store.get(previewErrorMessageAtom)).toBeUndefined();
    expect(
      store.get(appConsoleEntriesAtom).map((entry) => entry.message),
    ).toContain(
      "Cloud sandbox sync recovered. Local changes are uploading again.",
    );

    unmount();

    expect(appOutputListeners.size).toBe(0);
    expect(appOutputBatchListeners.size).toBe(0);
  });
});
