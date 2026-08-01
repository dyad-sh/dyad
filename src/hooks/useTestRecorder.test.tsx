import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import { appUrlByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
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
  onEndedMock,
} = vi.hoisted(() => ({
  startRecordingMock: vi.fn(),
  stopRecordingMock: vi.fn(),
  saveDraftMock: vi.fn(),
  discardDraftMock: vi.fn(),
  createRecordedSpecMock: vi.fn(),
  onEndedMock: vi.fn(),
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
        onEnded: onEndedMock,
        onSetupProgress: () => () => {},
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

/** Where the previewed app is served from — and the only origin the hook trusts. */
const PREVIEW_URL = "https://preview.test/";
const PREVIEW_ORIGIN = "https://preview.test";

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

/**
 * A stand-in for the preview iframe. The hook only accepts messages whose
 * `source` is the iframe's contentWindow AND whose origin is the app's own, and
 * posts commands back through it, so the fake records what it was told.
 */
function makeIframe() {
  const posted: any[] = [];
  const contentWindow = {
    postMessage: (message: unknown) => posted.push(message),
  };
  return {
    posted,
    contentWindow,
    el: { contentWindow } as unknown as HTMLIFrameElement,
    /** Deliver a message as if the preview had posted it up. */
    send(data: unknown, origin = PREVIEW_ORIGIN) {
      const event = new MessageEvent("message", { data, origin });
      // `source` is read-only on the prototype; shadow it on the instance.
      Object.defineProperty(event, "source", { value: contentWindow });
      window.dispatchEvent(event);
    },
  };
}

/** Point the hook's preview at a running dev server, as an active session is. */
function setAppUrl(store: ReturnType<typeof createStore>, appId: number) {
  store.set(
    appUrlByAppIdAtom,
    new Map([
      [
        appId,
        {
          appUrl: PREVIEW_URL,
          appId,
          originalUrl: PREVIEW_URL,
          mode: "host" as const,
        },
      ],
    ]),
  );
}

describe("useTestRecorder", () => {
  beforeEach(() => {
    startRecordingMock.mockReset();
    stopRecordingMock.mockReset();
    saveDraftMock.mockReset();
    discardDraftMock.mockReset();
    createRecordedSpecMock.mockReset();
    onEndedMock.mockReset();
    onEndedMock.mockReturnValue(() => {});
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

  it("keeps the review when the stop we asked for reports back late", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

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
    expect(result.current.phase).toBe("reviewing");

    // The main process reports the session ended for the very stop we asked
    // for. That event and the stopRecording reply travel different IPC
    // interfaces, so it can arrive after the review is already on screen —
    // resetting to idle here would take the steps and the assertions button
    // with it.
    const onEnded = onEndedMock.mock.calls.at(-1)![0];
    act(() => {
      onEnded({ appId: 1, reason: "stopped" });
    });

    expect(result.current.phase).toBe("reviewing");
    expect(result.current.draft?.testName).toBe("my flow");
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

  it("records SPA navigations from the shim's message envelope", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    // The shim (worker/dyad-shim.js) nests the URL under `payload`, unlike every
    // other message the hook consumes.
    act(() => {
      iframe.send({
        type: "pushState",
        payload: { oldUrl: "/", newUrl: "https://preview.test/items?q=x" },
      });
    });

    await waitFor(() => {
      expect(result.current.steps).toContain(`await page.goto("/items?q=x");`);
    });
  });

  it("ignores messages from a preview that navigated off the app's origin", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    // The iframe's WindowProxy keeps its identity across navigations, so an
    // external page the preview followed still passes the `source` check. Only
    // the origin tells them apart — and this one could otherwise write whatever
    // it liked into the user's generated test.
    act(() => {
      iframe.send(
        {
          type: "dyad-recorder-action",
          action: {
            kind: "click",
            locator: { kind: "testid", value: "spoofed" },
          },
        },
        "https://evil.example",
      );
    });

    await waitFor(() => {
      expect(result.current.entryCount).toBe(0);
    });
    expect(result.current.steps).toEqual([]);
  });

  it("still accepts preview messages while the dev server is restarting", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    // Isolation setup restarts the dev server, and the run command empties the
    // app URL until the new one arrives. The sign-in handshake runs straight
    // through that gap, so messages from the origin we already know must keep
    // being accepted — failing closed here would strand the session until the
    // 30s auth timeout.
    act(() => {
      store.set(appUrlByAppIdAtom, new Map());
    });
    act(() => {
      iframe.send({
        type: "dyad-recorder-action",
        action: {
          kind: "click",
          locator: { kind: "testid", value: "add" },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.steps).toContain(
        `await page.getByTestId("add").click();`,
      );
    });
  });

  it("hands the session back when the preview unmounts mid-recording", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result, unmount } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    // Switching to the Code tab takes away the only UI that can stop the
    // session; the isolated database and per-app lock must not outlive it.
    unmount();

    expect(stopRecordingMock).toHaveBeenCalledWith({ appId: 1 });
    expect(iframe.posted).toContainEqual({
      type: "deactivate-dyad-recorder",
    });
  });

  it("keeps the session after StrictMode's mount/unmount/remount replay", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper, reactStrictMode: true },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    // StrictMode runs the mount effect's cleanup on a hook that is still very
    // much mounted. Treating that as a real unmount handed the freshly prepared
    // session straight back — in dev, recording could never start.
    expect(stopRecordingMock).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);
  });

  it("disarms the in-page recorder when a session ends abnormally", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
    setAppUrl(store, 1);

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    iframe.posted.length = 0;

    const onEnded = onEndedMock.mock.calls.at(-1)![0];
    act(() => {
      onEnded({ appId: 1, reason: "timed-out", message: "session cap" });
    });

    // Otherwise the injected client keeps its capture-phase listeners and its
    // red hover overlay with no recording bar left to explain them.
    expect(iframe.posted).toContainEqual({
      type: "deactivate-dyad-recorder",
    });
    expect(result.current.phase).toBe("idle");
  });

  it("abandons setup when the selected app changes mid-start", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    let finishStart!: () => void;
    startRecordingMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = () =>
            resolve({
              appId: 1,
              isolation: { mode: "none" },
              auth: {
                mode: "neon-better-auth",
                email: "t@example.com",
                password: "s3cret",
              },
            });
        }),
    );

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });

    // The user switches apps while isolation is still being set up. The iframe
    // and app-URL refs now point at app 2, so app 1's test credentials must not
    // be delivered there — and app 1's session must not be left running.
    const iframe = makeIframe();
    act(() => {
      store.set(selectedAppIdAtom, 2);
      store.set(previewIframeRefAtom, iframe.el);
      setAppUrl(store, 1);
    });

    await act(async () => {
      finishStart();
      await started;
    });

    expect(stopRecordingMock).toHaveBeenCalledWith({ appId: 1 });
    expect(
      iframe.posted.some((message: any) => message?.type === "dyad-auth-login"),
    ).toBe(false);
    expect(result.current.phase).toBe("idle");
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
