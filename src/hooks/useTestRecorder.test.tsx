import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atom, createStore, Provider, useAtomValue } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUrlState } from "@/app_run/selectors";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import { recordingStartRequestAtom } from "@/atoms/recorderAtoms";
import { useTestRecorder } from "@/hooks/useTestRecorder";

/**
 * The preview's URL, as the recorder sees it. Driven through an atom rather than
 * a plain value so a test can bring the dev server down mid-session — the hook
 * has to re-render for that to reach it.
 */
const testAppUrlAtom = atom<AppUrlState>({
  appUrl: null,
  appId: null,
  originalUrl: null,
  mode: null,
});

vi.mock("@/hooks/useAppRun", () => ({
  useCurrentAppUrl: () => useAtomValue(testAppUrlAtom),
}));

const {
  startRecordingMock,
  stopRecordingMock,
  saveDraftMock,
  discardDraftMock,
  onEndedMock,
  onDraftConsumedMock,
  onDraftNamedMock,
} = vi.hoisted(() => ({
  startRecordingMock: vi.fn(),
  stopRecordingMock: vi.fn(),
  saveDraftMock: vi.fn(),
  discardDraftMock: vi.fn(),
  onEndedMock: vi.fn(),
  onDraftConsumedMock: vi.fn(),
  onDraftNamedMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    recording: {
      startRecording: startRecordingMock,
      stopRecording: stopRecordingMock,
      saveRecordedTestDraft: saveDraftMock,
      discardRecordedTestDraft: discardDraftMock,
    },
    events: {
      recording: {
        onEnded: onEndedMock,
        onSetupProgress: () => () => {},
        onDraftConsumed: onDraftConsumedMock,
        onDraftNamed: onDraftNamedMock,
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
  // The target origin each message was posted with, positionally aligned with
  // `posted`. What `postMessage` is *told* matters as much as what it sends:
  // one of these messages carries the isolated test user's password.
  const postedOrigins: (string | undefined)[] = [];
  const contentWindow = {
    postMessage: (message: unknown, targetOrigin?: string) => {
      posted.push(message);
      postedOrigins.push(targetOrigin);
    },
  };
  return {
    posted,
    postedOrigins,
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

/**
 * A preview reload, as far as the recorder can tell: the document is replaced
 * and the new one's recorder client announces itself. The hook waits for that
 * announce before arming, so a `reloadPreview` that never produces one leaves a
 * start hanging on its timeout — exactly as a preview that failed to load does.
 */
function reloadAnnouncing(iframe?: ReturnType<typeof makeIframe>) {
  return () => iframe?.send({ type: "dyad-recorder-initialized" });
}

/** Point the hook's preview at a running dev server, as an active session is. */
function setAppUrl(store: ReturnType<typeof createStore>, appId: number) {
  store.set(testAppUrlAtom, {
    appUrl: PREVIEW_URL,
    appId,
    originalUrl: PREVIEW_URL,
    mode: "host",
  });
}

/** The dev server going away, as it does while isolation restarts it. */
function clearAppUrl(store: ReturnType<typeof createStore>) {
  store.set(testAppUrlAtom, {
    appUrl: null,
    appId: null,
    originalUrl: null,
    mode: null,
  });
}

/**
 * Mount the hook for app 1 with the pieces a test asks for: `iframe` attaches a
 * fake preview window, `appUrl` points it at a running dev server (both are
 * required before the hook will accept or send preview messages).
 */
function mountRecorder({
  iframe,
  appUrl = false,
  reloadPreview,
}: {
  iframe?: ReturnType<typeof makeIframe>;
  appUrl?: boolean;
  reloadPreview?: () => void;
} = {}) {
  const { store, Wrapper } = makeWrapper();
  store.set(selectedAppIdAtom, 1);
  if (iframe) store.set(previewIframeRefAtom, iframe.el);
  if (appUrl) setAppUrl(store, 1);
  const reload = reloadPreview ?? reloadAnnouncing(iframe);
  const { result, unmount, rerender } = renderHook(
    () => useTestRecorder({ reloadPreview: reload }),
    { wrapper: Wrapper },
  );
  return { store, Wrapper, result, unmount, rerender };
}

/**
 * Answer the storage warning a parked record request raises.
 *
 * The Tests panel's Record button doesn't start a session directly — it leaves
 * a request the hook turns into an ask, because setup clears the preview's
 * cookies and local storage.
 */
async function confirmParkedStart(result: {
  current: ReturnType<typeof useTestRecorder>;
}) {
  await waitFor(() => expect(result.current.pendingStart).not.toBeNull());
  // Nothing may have been started before the user said yes.
  expect(startRecordingMock).not.toHaveBeenCalled();
  await act(async () => {
    result.current.confirmStartRecording();
  });
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
    onEndedMock.mockReset();
    onEndedMock.mockReturnValue(() => {});
    onDraftConsumedMock.mockReset();
    onDraftConsumedMock.mockReturnValue(() => {});
    onDraftNamedMock.mockReset();
    onDraftNamedMock.mockReturnValue(() => {});
    startRecordingMock.mockResolvedValue({
      appId: 1,
      isolation: { mode: "none" },
      auth: { mode: "none" },
    });
    stopRecordingMock.mockResolvedValue({ ok: true });
    saveDraftMock.mockResolvedValue({ ok: true });
    discardDraftMock.mockResolvedValue({ ok: true });
  });

  it("starts a session for a record request made outside the preview", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    store.set(recordingStartRequestAtom, { appId: 1, requestedAt: Date.now() });

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );

    await confirmParkedStart(result);

    await waitFor(() => {
      expect(startRecordingMock).toHaveBeenCalledWith({ appId: 1 });
    });
    // Consumed, so remounting the preview doesn't start a second session.
    expect(store.get(recordingStartRequestAtom)).toBeNull();
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });
  });

  it("starts nothing when the storage warning is dismissed", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    store.set(recordingStartRequestAtom, { appId: 1, requestedAt: Date.now() });

    const { result } = renderHook(
      () => useTestRecorder({ reloadPreview: () => {} }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.pendingStart).not.toBeNull());
    act(() => {
      result.current.dismissStartRecording();
    });

    // Declining has to leave the preview's cookies and local storage alone —
    // clearing them is the first thing the session does.
    expect(startRecordingMock).not.toHaveBeenCalled();
    expect(result.current.pendingStart).toBeNull();
    expect(result.current.phase).toBe("idle");
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

    await confirmParkedStart(result);

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

    // The draft is parked in the main process for the test proposal...
    expect(saveDraftMock).toHaveBeenCalledWith({
      appId: 1,
      draft: expect.objectContaining({ testName: "My Flow", authMode: "none" }),
    });
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
    // thing that tells the bar its draft is now a file. Left up, it would go on
    // offering to propose a recording that has already been written.
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
    // The draft is untouched: asking again and discarding it are exactly what
    // the user needs once the request came back empty.
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.draft?.testName).toBe("my flow");
  });

  it("waits for the reloaded preview before it says it is recording", async () => {
    const iframe = makeIframe();
    // A reload whose document hasn't come up yet — the window between asking
    // for one and the new document's recorder client announcing itself.
    const { result } = mountRecorder({
      iframe,
      appUrl: true,
      reloadPreview: () => {},
    });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });
    await waitFor(() => expect(startRecordingMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // Still setting up. Saying "Recording" here promises capture the recorder
    // can't deliver: the document that would be armed is being replaced, and
    // everything done in the gap — usually the first click of the flow — is
    // dropped without a trace.
    expect(result.current.isRecording).toBe(false);
    expect(iframe.posted).not.toContainEqual({
      type: "activate-dyad-recorder",
    });

    await act(async () => {
      iframe.send({ type: "dyad-recorder-initialized" });
      await started;
    });

    expect(result.current.isRecording).toBe(true);
    expect(iframe.posted).toContainEqual({ type: "activate-dyad-recorder" });
  });

  it("frees the next start when a no-auth setup is cancelled mid-reload", async () => {
    const iframe = makeIframe();
    // The reload never announces, so the start parks on the readiness wait —
    // the same place a preview that is slow to come up leaves it.
    const { result } = mountRecorder({
      iframe,
      appUrl: true,
      reloadPreview: () => {},
    });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });
    await waitFor(() => expect(startRecordingMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isRecording).toBe(false);

    await act(async () => {
      await result.current.cancelRecording();
      await started;
    });
    expect(result.current.phase).toBe("idle");

    // The readiness wait only gives up after five seconds, and the parked
    // `beginRecording` is what holds this app's start entry. Leaving it there
    // made the bar look idle while the next Record click was silently dropped.
    startRecordingMock.mockClear();
    let restarted!: Promise<void>;
    act(() => {
      restarted = result.current.startRecording();
    });
    await waitFor(() =>
      expect(startRecordingMock).toHaveBeenCalledWith({ appId: 1 }),
    );

    // This preview never announces either, so unwind rather than leaving the
    // second start parked past the end of the test.
    await act(async () => {
      await result.current.cancelRecording();
      await restarted;
    });
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

  it("throws the recording away when the review is discarded", async () => {
    const { result } = await recordingSession();
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });

    await act(async () => {
      await result.current.discardDraft();
    });

    // The parked draft goes with it, so a queued assertion turn can't annotate
    // a recording the user threw away.
    expect(discardDraftMock).toHaveBeenCalledWith({ appId: 1 });
    expect(result.current.phase).toBe("idle");
    expect(result.current.draft).toBeUndefined();
  });

  it("ignores navigations the app makes on its own", async () => {
    const iframe = makeIframe();
    const { result } = await recordingSession({ iframe, appUrl: true });

    // The shim (worker/dyad-shim.js) reports every history change the app makes,
    // which is almost always the app routing in response to the click that is
    // already recorded. Following that click with `page.goto` would take the
    // test to the destination even when the click stops navigating — hiding the
    // regression instead of failing on it.
    act(() => {
      iframe.send({
        type: "pushState",
        payload: { oldUrl: "/", newUrl: "https://preview.test/items?q=x" },
      });
    });

    await waitFor(() => {
      expect(result.current.entryCount).toBe(0);
    });
    expect(result.current.steps).toEqual([]);
  });

  it("records a navigation made from Dyad's own address bar", async () => {
    const { result } = await recordingSession({
      iframe: makeIframe(),
      appUrl: true,
    });

    // Typing a path (or picking one from the routes dropdown) is a jump around
    // the app rather than through it: nothing else in the recording would take
    // the test there.
    act(() => {
      result.current.recordNavigation("/items?q=x");
    });

    await waitFor(() => {
      expect(result.current.steps).toEqual([`await page.goto("/items?q=x");`]);
    });
  });

  it("records the preview's history buttons as history moves", async () => {
    const { result } = await recordingSession({
      iframe: makeIframe(),
      appUrl: true,
    });

    act(() => {
      result.current.recordHistoryMove("back");
      result.current.recordHistoryMove("forward");
    });

    // Not a `goto` to wherever the user landed: going back is the thing being
    // performed, and a `goto` would arrive there even if the app's history
    // handling were broken.
    await waitFor(() => {
      expect(result.current.steps).toEqual([
        `await page.goBack();`,
        `await page.goForward();`,
      ]);
    });
  });

  it("ignores a manual navigation that would leave the app", async () => {
    const { result } = await recordingSession({
      iframe: makeIframe(),
      appUrl: true,
    });

    act(() => {
      result.current.recordNavigation("//evil.example/steal");
    });

    await waitFor(() => {
      expect(result.current.entryCount).toBe(0);
    });
  });

  it("records nothing once the recording has stopped", async () => {
    const { result } = await recordingSession({ appUrl: true });
    await act(async () => {
      await result.current.stopAndReview("my flow");
    });

    act(() => {
      result.current.recordNavigation("/late");
    });

    // The draft is closed; a navigation made while reviewing it belongs to
    // whatever the user is doing next, not to the recording.
    expect(result.current.draftSteps).toEqual([`await page.goto("/");`]);
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
      clearAppUrl(store);
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

  /** A start held mid-setup, plus the lever that lets it finish. */
  function holdStart() {
    let finishStart!: () => void;
    startRecordingMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = () =>
            resolve({
              appId: 1,
              sessionId: "session-1",
              isolation: { mode: "none" },
              auth: { mode: "none" },
            });
        }),
    );
    return () => finishStart();
  }

  it.each([
    [
      "the app changes",
      (mounted: ReturnType<typeof mountRecorder>) =>
        mounted.store.set(selectedAppIdAtom, 2),
    ],
    [
      "the preview unmounts",
      (mounted: ReturnType<typeof mountRecorder>) => mounted.unmount(),
    ],
  ])(
    "hands back a session that is still being prepared when %s",
    async (_label, walkAway) => {
      const finishStart = holdStart();
      const mounted = mountRecorder();

      let started!: Promise<void>;
      act(() => {
        started = mounted.result.current.startRecording();
      });

      // Isolation setup takes seconds, and the main process registers the
      // session — per-app lock and temporary database environment — as soon as
      // the request arrives. Waiting for the start to return would leave that
      // session serving an app with no recorder UI left to end it.
      await act(async () => {
        walkAway(mounted);
      });

      expect(stopRecordingMock).toHaveBeenCalledWith({ appId: 1 });

      // The stop can also land before the main process has registered the
      // session, so the start that eventually returns must hand it back too
      // rather than adopting it.
      stopRecordingMock.mockClear();
      await act(async () => {
        finishStart();
        await started;
      });
      expect(stopRecordingMock).toHaveBeenCalledWith({ appId: 1 });
    },
  );

  it("keeps the session after StrictMode's mount/unmount/remount replay", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(selectedAppIdAtom, 1);
    const iframe = makeIframe();
    store.set(previewIframeRefAtom, iframe.el);
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
      () => useTestRecorder({ reloadPreview: reloadAnnouncing(iframe) }),
      { wrapper: Wrapper, reactStrictMode: true },
    );

    await confirmParkedStart(result);

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

  /** A start that comes back with credentials to establish before recording. */
  function authenticatedStart() {
    startRecordingMock.mockResolvedValue({
      appId: 1,
      sessionId: "session-1",
      isolation: { mode: "none" },
      auth: {
        mode: "neon-better-auth",
        email: "t@dyad.test",
        password: "s3cret",
      },
    });
  }

  function findLogin(iframe: ReturnType<typeof makeIframe>) {
    const index = iframe.posted.findIndex(
      (message: any) => message?.type === "dyad-auth-login",
    );
    return index === -1
      ? null
      : { message: iframe.posted[index], origin: iframe.postedOrigins[index] };
  }

  it("signs the preview in at the app's own origin", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });

    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());
    const login = findLogin(iframe)!;
    // Pinned to the app's own origin. `postMessage` delivers to whoever the
    // frame is currently showing, so "*" here would hand the test user's
    // password to a preview that had followed a link off-origin.
    expect(login.origin).toBe(PREVIEW_ORIGIN);
    expect(login.message.auth).toEqual({
      mode: "neon-better-auth",
      email: "t@dyad.test",
      password: "s3cret",
    });

    await act(async () => {
      iframe.send({
        type: "dyad-auth-ready",
        ok: true,
        nonce: login.message.nonce,
      });
      await started;
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.auth?.mode).toBe("neon-better-auth");
  });

  it("withholds credentials until the preview's origin is known", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    // No app URL yet: isolation setup restarts the dev server, and the run
    // command empties the URL until the new one arrives.
    const { store, result } = mountRecorder({ iframe });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });

    await waitFor(() => expect(result.current.phase).toBe("authenticating"));
    // Nothing goes out while the only available target would be "*".
    expect(findLogin(iframe)).toBeNull();

    // Nothing is lost by waiting: the fresh load announces itself, and that
    // announce — accepted only from the app's own origin — triggers the resend.
    act(() => {
      setAppUrl(store, 1);
    });
    act(() => {
      iframe.send({ type: "dyad-auth-bootstrap-ready" });
    });

    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());
    const login = findLogin(iframe)!;
    expect(login.origin).toBe(PREVIEW_ORIGIN);

    await act(async () => {
      iframe.send({
        type: "dyad-auth-ready",
        ok: true,
        nonce: login.message.nonce,
      });
      await started;
    });

    expect(result.current.isRecording).toBe(true);
  });

  it("records unauthenticated rather than dead-ending on a failed sign-in", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });
    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());
    const login = findLogin(iframe)!;

    await act(async () => {
      iframe.send({
        type: "dyad-auth-ready",
        ok: false,
        error: "no session after sign-in",
        nonce: login.message.nonce,
      });
      await started;
    });

    // The flow degrades instead of stopping: plenty of recordings don't need a
    // signed-in user, and the warning is what tells the user which one this is.
    expect(result.current.isRecording).toBe(true);
    expect(result.current.auth).toEqual({ mode: "none" });
    expect(result.current.warning).toMatch(/without authentication/i);
  });

  it("ignores a sign-in result from an attempt that already timed out", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    act(() => {
      void result.current.startRecording();
    });
    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());

    // Without the nonce check a stale completion would advance whatever attempt
    // is current to "recording" on credentials that were never established.
    act(() => {
      iframe.send({
        type: "dyad-auth-ready",
        ok: true,
        nonce: "some-other-attempt",
      });
    });

    expect(result.current.phase).toBe("authenticating");
  });

  it("stays cancelled when a start returns after Cancel was pressed in setup", async () => {
    const finishStart = holdStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });

    // The Cancel now offered during `starting`/`authenticating`. Dropping
    // ownership isn't enough on its own: `beginRecording` only *adds* ownership
    // after its request returns, so an uncancelled attempt sails past its
    // abandonment checks and re-adopts the session that was just stopped.
    await act(async () => {
      await result.current.cancelRecording();
    });
    stopRecordingMock.mockClear();

    await act(async () => {
      finishStart();
      await started;
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.phase).toBe("idle");
    // The session that came up after the cancel still has to be handed back.
    expect(stopRecordingMock).toHaveBeenCalledWith({ appId: 1 });
  });

  it("releases the start immediately when a session ends during sign-in", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });
    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());

    // Without settling the pending sign-in here, `beginRecording` sits on its
    // 30-second timeout — and that await is what holds the app's entry in
    // `startingAppsRef`, refusing a fresh recording for the whole window.
    const onEnded = onEndedMock.mock.calls.at(-1)![0];
    await act(async () => {
      onEnded({ appId: 1, sessionId: "session-1", reason: "app-stopped" });
      await started;
    });

    expect(result.current.phase).toBe("idle");
  });

  it("never arms the recorder when the session ended during sign-in", async () => {
    authenticatedStart();
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    let started!: Promise<void>;
    act(() => {
      started = result.current.startRecording();
    });
    await waitFor(() => expect(findLogin(iframe)).not.toBeNull());
    const login = findLogin(iframe)!;

    // Stop / Restart / Delete all end the session in main, and the ending that
    // follows drops our ownership. None of that touches the start attempt, so
    // the app-selection guard still reads as healthy.
    const onEnded = onEndedMock.mock.calls.at(-1)![0];
    act(() => {
      onEnded({ appId: 1, sessionId: "session-1", reason: "app-stopped" });
    });

    await act(async () => {
      iframe.send({
        type: "dyad-auth-ready",
        ok: true,
        nonce: login.message.nonce,
      });
      await started;
    });

    // Otherwise: a bar reading "Recording", an armed in-page client, and every
    // captured action landing against the app's restored real database.
    expect(result.current.isRecording).toBe(false);
    expect(result.current.phase).toBe("idle");
  });

  it("replays the route recording started on, so the spec doesn't open elsewhere", async () => {
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    // No managed auth, so nothing navigates the preview home — but every
    // generated spec opens with `page.goto("/")`.
    await act(async () => {
      await result.current.startRecording("/items?q=x");
    });

    await waitFor(() => {
      expect(result.current.steps).toEqual([`await page.goto("/items?q=x");`]);
    });
  });

  it("adds nothing when recording already starts at the root", async () => {
    const iframe = makeIframe();
    const { result } = mountRecorder({ iframe, appUrl: true });

    await act(async () => {
      await result.current.startRecording("/");
    });

    // `page.goto("/")` is already the opening statement; a second one is noise.
    expect(result.current.steps).toEqual([]);
  });

  it("refuses the review when teardown reported the environment broken", async () => {
    const iframe = makeIframe();
    const { result } = await recordingSession({ iframe, appUrl: true });

    // The ending and the `stopRecording` reply travel different IPC interfaces,
    // so the error lands first and the review would overwrite it — offering a
    // recording to approve with no sign the app is still on the test branch.
    const onEnded = onEndedMock.mock.calls.at(-1)![0];
    act(() => {
      onEnded({
        appId: 1,
        reason: "error",
        message: "Dyad couldn't restore your app's real database settings",
      });
    });

    let draft: unknown;
    await act(async () => {
      draft = await result.current.stopAndReview("my flow");
    });

    expect(draft).toBeNull();
    expect(result.current.phase).toBe("idle");
    expect(discardDraftMock).toHaveBeenCalledWith({ appId: 1 });
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
