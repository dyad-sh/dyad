import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  RECORDING_REQUEST_TTL_MS,
  recordingStartRequestAtom,
} from "@/atoms/recorderAtoms";
import { useTestRecorder } from "@/hooks/useTestRecorder";

const {
  startRecordingMock,
  stopRecordingMock,
  saveDraftMock,
  discardDraftMock,
  createRecordedSpecMock,
} = vi.hoisted(() => ({
  startRecordingMock: vi.fn(),
  stopRecordingMock: vi.fn(),
  saveDraftMock: vi.fn(),
  discardDraftMock: vi.fn(),
  createRecordedSpecMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    recording: {
      startRecording: startRecordingMock,
      stopRecording: stopRecordingMock,
      saveRecordedTestDraft: saveDraftMock,
      discardRecordedTestDraft: discardDraftMock,
    },
    tests: {
      createRecordedSpec: createRecordedSpecMock,
    },
    events: {
      recording: {
        onEnded: () => () => {},
        onSetupProgress: () => () => {},
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

function makeWrapper() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    store,
    Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      );
    },
  };
}

describe("useTestRecorder", () => {
  beforeEach(() => {
    startRecordingMock.mockReset();
    stopRecordingMock.mockReset();
    saveDraftMock.mockReset();
    discardDraftMock.mockReset();
    createRecordedSpecMock.mockReset();
    startRecordingMock.mockResolvedValue({
      appId: 1,
      isolation: { mode: "none" },
      auth: { mode: "none" },
    });
    stopRecordingMock.mockResolvedValue({ ok: true });
    saveDraftMock.mockResolvedValue({ ok: true });
    discardDraftMock.mockResolvedValue({ ok: true });
    createRecordedSpecMock.mockResolvedValue({
      specPath: "e2e-tests/recorded-my-flow.spec.ts",
    });
  });

  it("starts a session for a record request made outside the preview", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    store.set(recordingStartRequestAtom, { appId: 1, requestedAt: Date.now() });

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(startRecordingMock).toHaveBeenCalledWith({ appId: 1 });
    });
    // Consumed, so remounting the preview doesn't start a second session.
    expect(store.get(recordingStartRequestAtom)).toBeNull();
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });
  });

  it("drops a request that went unconsumed for too long", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    store.set(recordingStartRequestAtom, {
      appId: 1,
      requestedAt: Date.now() - RECORDING_REQUEST_TTL_MS - 1,
    });

    renderHook(() => useTestRecorder({ reloadPreview: () => {} }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(store.get(recordingStartRequestAtom)).toBeNull();
    });
    expect(startRecordingMock).not.toHaveBeenCalled();
  });

  it("leaves a fresh request for another app alone", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const request = { appId: 2, requestedAt: Date.now() };
    store.set(recordingStartRequestAtom, request);

    renderHook(() => useTestRecorder({ reloadPreview: () => {} }), {
      wrapper: Wrapper,
    });

    expect(startRecordingMock).not.toHaveBeenCalled();
    expect(store.get(recordingStartRequestAtom)).toBe(request);
  });

  it("stays in a stopping phase until teardown finishes", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    let finishTeardown!: () => void;
    stopRecordingMock.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          finishTeardown = () => resolve({ ok: true });
        }),
    );

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    let cancelled!: Promise<void>;
    act(() => {
      cancelled = result.current.cancelRecording();
    });

    // Teardown (dropping the Neon branch / Supabase test user) is still in
    // flight, so the banner must keep showing a spinner instead of vanishing.
    expect(result.current.phase).toBe("stopping");
    expect(result.current.isBusy).toBe(true);

    await act(async () => {
      finishTeardown();
      await cancelled;
    });
    expect(result.current.phase).toBe("idle");
  });

  it("stops into a review phase without writing anything", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await result.current.stopAndReview("  My Flow  ");
    });

    // The draft is parked in the main process for the assertion pass...
    expect(saveDraftMock).toHaveBeenCalledWith({
      appId: 1,
      draft: expect.objectContaining({ testName: "My Flow", authMode: "none" }),
    });
    // ...and NOTHING was written: the spec only exists once the user approves
    // a plan (or asks to save without assertions).
    expect(createRecordedSpecMock).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.draft?.testName).toBe("My Flow");
    // The review list is the spec body, numbered as the assertion pass sees it.
    expect(result.current.draftSteps).toEqual([`await page.goto("/");`]);
  });

  it("generates the spec from the draft when saving without assertions", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });

    await act(async () => {
      await result.current.saveWithoutAssertions();
    });

    expect(createRecordedSpecMock).toHaveBeenCalledWith({
      appId: 1,
      draft: expect.objectContaining({ testName: "my flow" }),
    });
    expect(result.current.phase).toBe("saved");
    expect(result.current.savedSpecPath).toBe(
      "e2e-tests/recorded-my-flow.spec.ts",
    );
  });

  it("keeps the recording reviewable when generating the spec fails", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    createRecordedSpecMock.mockRejectedValue(new Error("disk full"));

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });

    await act(async () => {
      await result.current.saveWithoutAssertions();
    });

    // A failed write must not throw the session away.
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.draft?.testName).toBe("my flow");
  });

  it("drops the parked draft when the recording is discarded", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });

    await act(async () => {
      await result.current.discardDraft();
    });

    expect(discardDraftMock).toHaveBeenCalledWith({ appId: 1 });
    expect(result.current.phase).toBe("idle");
  });
});
