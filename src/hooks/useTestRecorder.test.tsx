import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import { appUrlByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
import { recordingStartRequestAtom } from "@/atoms/recorderAtoms";
import { useTestRecorder } from "@/hooks/useTestRecorder";

const {
  startRecordingMock,
  stopRecordingMock,
  saveDraftMock,
  discardDraftMock,
  createRecordedSpecMock,
  onEndedMock,
  onDraftConsumedMock,
} = vi.hoisted(() => ({
  startRecordingMock: vi.fn(),
  stopRecordingMock: vi.fn(),
  saveDraftMock: vi.fn(),
  discardDraftMock: vi.fn(),
  createRecordedSpecMock: vi.fn(),
  onEndedMock: vi.fn(),
  onDraftConsumedMock: vi.fn(),
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
        onDraftConsumed: onDraftConsumedMock,
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

/**
 * Mount the hook for app 1 with the pieces a test asks for: `iframe` attaches a
 * fake preview window, `appUrl` points it at a running dev server (both are
 * required before the hook will accept or send preview messages).
 */
function mountRecorder({
  iframe,
  appUrl = false,
  reloadPreview = () => {},
}: {
  iframe?: ReturnType<typeof makeIframe>;
  appUrl?: boolean;
  reloadPreview?: () => void;
} = {}) {
  const { store, Wrapper } = makeWrapper();
  store.set(selectedAppIdAtom, 1);
  if (iframe) store.set(previewIframeRefAtom, iframe.el);
  if (appUrl) setAppUrl(store, 1);
  const { result, unmount, rerender } = renderHook(
    () => useTestRecorder({ reloadPreview }),
    { wrapper: Wrapper },
  );
  return { store, Wrapper, result, unmount, rerender };
}

/** `mountRecorder` plus a started session — the preamble most tests need. */
async function recordingSession(
  options: Parameters<typeof mountRecorder>[0] = {},
) {
  const mounted = mountRecorder(options);
  await act(async () => {
    await mounted.result.current.startRecording();
  });
  return mounted;
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
    onDraftConsumedMock.mockReset();
    onDraftConsumedMock.mockReturnValue(() => {});
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

  it("starts one session for a record request replayed by StrictMode", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    store.set(recordingStartRequestAtom, { appId: 1, requestedAt: Date.now() });

    // The Tests panel's Record button switches to the preview tab, so the hook
    // mounts with the request already parked and StrictMode replays the effect
    // that consumes it with the same render's (still non-null) value.
    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });
    // A second ask is rejected by the main process ("a recording session is
    // already in progress"), which toasted an error over a healthy session.
    expect(startRecordingMock).toHaveBeenCalledTimes(1);
  });

  it("stops into a review phase without writing anything", async () => {
    const { result } = await recordingSession();

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

  it("closes the review once the assertions card has generated the spec", async () => {
    const { result } = await recordingSession({ appUrl: true });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });
    result.current.markAwaitingAssertions();
    expect(result.current.phase).toBe("reviewing");

    // Approval happens entirely in the chat card, so this event is the only
    // thing that tells the bar its draft is now a file. Left up, its "Save
    // without assertions" would write a second, suffixed copy of the same test.
    const onDraftConsumed = onDraftConsumedMock.mock.calls[0][0];
    act(() => {
      onDraftConsumed({
        appId: 1,
        specPath: "e2e-tests/recorded-my-flow.spec.ts",
      });
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.draft).toBeUndefined();
  });

  it("stops waiting on the AI once the assertion turn has ended", async () => {
    const { result } = await recordingSession({ appUrl: true });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });
    act(() => {
      result.current.markAwaitingAssertions();
    });
    expect(result.current.awaitingAssertions).toBe(true);

    // A turn can end with no card at all — stopped by the user, errored, or a
    // reply that never called the tool. Only approval closes the bar on its
    // own, so without this it went on claiming the AI was still working.
    act(() => {
      result.current.clearAwaitingAssertions(1);
    });

    expect(result.current.awaitingAssertions).toBe(false);
    // The draft is untouched: saving it as-is, discarding it and asking again
    // are exactly what the user needs once the request came back empty.
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.draft?.testName).toBe("my flow");
  });

  it("keeps the review when the stop we asked for reports back late", async () => {
    const { result } = await recordingSession({
      iframe: makeIframe(),
      appUrl: true,
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
    const { result } = await recordingSession();
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
    createRecordedSpecMock.mockRejectedValue(new Error("disk full"));

    const { result } = await recordingSession();
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
    const iframe = makeIframe();
    const { result } = await recordingSession({ iframe, appUrl: true });

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
    const iframe = makeIframe();
    const { result } = await recordingSession({ iframe, appUrl: true });

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
    const iframe = makeIframe();
    const { store, result } = await recordingSession({ iframe, appUrl: true });

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
    const iframe = makeIframe();
    const { result, unmount } = await recordingSession({
      iframe,
      appUrl: true,
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
    store.set(previewIframeRefAtom, makeIframe().el);
    setAppUrl(store, 1);
    // Started from the parked request, and held mid-setup, so the session is
    // genuinely in flight *across* the replay. Starting afterwards would leave
    // nothing for the cleanup to hand back, and the test would pass either way.
    store.set(recordingStartRequestAtom, { appId: 1, requestedAt: Date.now() });
    let releaseStart: (() => void) | undefined;
    startRecordingMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStart = () =>
            resolve({
              appId: 1,
              isolation: { mode: "none" },
              auth: { mode: "none" },
            });
        }),
    );

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper, reactStrictMode: true },
    );

    await waitFor(() => expect(releaseStart).toBeDefined());
    await act(async () => {
      releaseStart!();
    });

    // StrictMode runs the mount effect's cleanup on a hook that is still very
    // much mounted. Treating that as a real unmount handed the freshly prepared
    // session straight back — in dev, recording could never start.
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(stopRecordingMock).not.toHaveBeenCalled();
  });

  it("disarms the in-page recorder when a session ends abnormally", async () => {
    const iframe = makeIframe();
    const { result } = await recordingSession({ iframe, appUrl: true });
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

    const { store, result } = mountRecorder();

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
});
