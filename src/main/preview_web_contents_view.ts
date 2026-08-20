import { randomUUID } from "node:crypto";

import { WebContentsView, shell } from "electron";
import type { BrowserWindow, Session } from "electron";
import log from "electron-log";

import { safeSend } from "../ipc/utils/safe_sender";
import { DyadError, DyadErrorKind } from "../errors/dyad_error";
import {
  previewViewEvents,
  type PreviewViewBounds,
} from "../ipc/types/preview_view";

const logger = log.scope("preview_web_contents_view");

/** Chromium's ERR_ABORTED, emitted whenever a load is superseded or cancelled. */
const ERR_ABORTED = -3;

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
const SCREENSHOT_INTERVAL_MS = 1_000;

interface PreviewViewEntry {
  view: WebContentsView;
  /** The view's unique, in-memory session, retained for explicit cleanup. */
  session: Session;
  /** The URL most recently handed to loadURL, used to keep `show` idempotent. */
  currentUrl: string | null;
  disposeHostHooks: () => void;
  /**
   * Set while a test run drives this view over CDP. The page must outlive the
   * React component for the run's duration, so hiding is downgraded to
   * `setVisible(false)` and external side effects are suppressed.
   */
  automationActive: boolean;
  /** The renderer asked to hide while automation held the view open. */
  hiddenDuringAutomation: boolean;
  /** Lets the runner report a view that was destroyed out from under it. */
  onAutomationViewDestroyed: (() => void) | null;
  /** True while renderer UI overlaps the native surface. */
  overlayActive: boolean;
  /** Last renderer-provided layout, retained when automation rotates the view. */
  bounds: PreviewViewBounds | null;
  /** The sole retained screenshot; replacement releases the previous string. */
  latestScreenshotDataUrl: string | null;
  screenshotTimer: ReturnType<typeof setInterval> | null;
  screenshotCapturePending: boolean;
}

/**
 * Live preview views, keyed by the id of the *host* renderer's webContents so
 * each product window gets its own view. Entries only exist while the preview
 * is meant to be visible: hiding destroys the view rather than detaching it, so
 * a backgrounded preview cannot keep timers, sockets, or audio running.
 */
const entries = new Map<number, PreviewViewEntry>();

/**
 * Host renderer keys whose preview view a starting test run has claimed.
 *
 * Held outside the entry map on purpose. A panel run claims the view before the
 * isolation step — which can spend many seconds branching a database and
 * restarting the dev server — and at that moment the renderer may not have
 * mounted the view yet, so there is no entry to mark. Anything the user does in
 * the meantime (the "Tests running…" chip, the exit button) unmounts the React
 * component and hides the view; without this, that would destroy the page the
 * run is about to attach to and dead-end it.
 */
const automationReservations = new Set<number>();

function isClaimedForAutomation(
  key: number,
  entry: PreviewViewEntry | undefined,
): boolean {
  return !!entry?.automationActive || automationReservations.has(key);
}

/**
 * Claims this window's preview view for a run that is still setting up, so
 * hiding it is downgraded rather than destroying it. Returns a release
 * function; callers must invoke it on every exit path.
 */
export function reservePreviewViewForAutomation(
  window: BrowserWindow,
): () => void {
  const key = resolveKey(window);
  if (key === null) return () => {};

  automationReservations.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    automationReservations.delete(key);

    // The renderer asked to hide while the claim was standing and no automation
    // session took over to honor it later; do that now rather than stranding an
    // invisible view.
    const entry = entries.get(key);
    if (entry && !entry.automationActive && entry.hiddenDuringAutomation) {
      entry.hiddenDuringAutomation = false;
      destroyEntry(key, window);
    }
  };
}

function resolveKey(window: BrowserWindow): number | null {
  try {
    if (window.isDestroyed()) return null;
    return window.webContents.id;
  } catch {
    return null;
  }
}

function getEntry(window: BrowserWindow): PreviewViewEntry | undefined {
  const key = resolveKey(window);
  return key === null ? undefined : entries.get(key);
}

export function isSupportedPreviewUrl(url: string): boolean {
  try {
    return SUPPORTED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function roundBounds(bounds: PreviewViewBounds) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function openExternally(url: string): void {
  if (!isSupportedPreviewUrl(url)) return;
  void shell.openExternal(url).catch((error) => {
    logger.warn(`Failed to open ${url} externally:`, error);
  });
}

function emitNavigationState(
  window: BrowserWindow,
  entry: PreviewViewEntry,
): void {
  const contents = entry.view.webContents;
  if (contents.isDestroyed()) return;

  safeSend(window.webContents, previewViewEvents.navigationState.channel, {
    url: contents.getURL(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    isLoading: contents.isLoading(),
  } satisfies {
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
  });
}

function emitScreenshot(window: BrowserWindow, dataUrl: string | null): void {
  if (!dataUrl) return;
  safeSend(window.webContents, previewViewEvents.screenshotUpdated.channel, {
    dataUrl,
  });
}

async function capturePreviewScreenshot(
  window: BrowserWindow,
  key: number,
  entry: PreviewViewEntry,
): Promise<void> {
  if (entry.screenshotCapturePending || entry.hiddenDuringAutomation) {
    return;
  }

  const contents = entry.view.webContents;
  if (contents.isDestroyed()) return;

  entry.screenshotCapturePending = true;
  try {
    // Electron temporarily marks a hidden page as visible while capturing it.
    // Keep it hidden so the native surface cannot flash over renderer UI.
    const image = await contents.capturePage(undefined, { stayHidden: true });
    if (
      entries.get(key) !== entry ||
      contents.isDestroyed() ||
      image.isEmpty()
    ) {
      return;
    }

    // Keep only one in-memory string. Assigning the new value makes both the
    // NativeImage and the previous data URL unreachable after this turn.
    const dataUrl = image.toDataURL();
    entry.latestScreenshotDataUrl = dataUrl;
    emitScreenshot(window, dataUrl);
  } catch (error) {
    logger.debug("Failed to capture preview view screenshot:", error);
  } finally {
    entry.screenshotCapturePending = false;
  }
}

/**
 * Refreshes the screenshot fallback on a timer.
 *
 * Only runs while an overlay is up. A capture is a full raster plus a
 * multi-hundred-KB base64 string over IPC, and the renderer never paints it
 * unless something is covering the native surface — polling for the life of the
 * view would spend that every second, throughout a test run, for nothing.
 */
function startScreenshotCapture(
  window: BrowserWindow,
  key: number,
  entry: PreviewViewEntry,
): void {
  if (entry.screenshotTimer !== null) return;
  const timer = setInterval(() => {
    void capturePreviewScreenshot(window, key, entry);
  }, SCREENSHOT_INTERVAL_MS);
  timer.unref?.();
  entry.screenshotTimer = timer;
}

function pauseScreenshotCapture(entry: PreviewViewEntry): void {
  if (entry.screenshotTimer !== null) {
    clearInterval(entry.screenshotTimer);
    entry.screenshotTimer = null;
  }
}

function stopScreenshotCapture(entry: PreviewViewEntry): void {
  pauseScreenshotCapture(entry);
  entry.latestScreenshotDataUrl = null;
}

function createEntry(window: BrowserWindow, key: number): PreviewViewEntry {
  // No `persist:` prefix: Electron keeps this partition in memory only. A UUID
  // makes every mounted test preview a fresh browser profile, so credentials
  // from a prior run can never be inherited even if cleanup is interrupted.
  const partition = `dyad-preview-test-${key}-${randomUUID()}`;
  const view = new WebContentsView({
    webPreferences: {
      // The previewed app is untrusted, user-generated code. It gets no
      // preload, no Node, and no access to Dyad's IPC surface.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition,
    },
  });

  const entry: PreviewViewEntry = {
    view,
    session: view.webContents.session,
    currentUrl: null,
    disposeHostHooks: () => {},
    automationActive: false,
    hiddenDuringAutomation: false,
    onAutomationViewDestroyed: null,
    overlayActive: false,
    bounds: null,
    latestScreenshotDataUrl: null,
    screenshotTimer: null,
    screenshotCapturePending: false,
  };

  const contents = view.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    // A driven test must not spray the user's system browser with windows.
    if (!entry.automationActive) {
      openExternally(url);
    }
    return { action: "deny" };
  });

  const restrictNavigation = (
    event: Electron.Event,
    url: string,
    isInPlace?: boolean,
    isMainFrame?: boolean,
  ) => {
    // Sub-frame and same-document navigations stay inside the app.
    if (isMainFrame === false || isInPlace) return;
    if (entry.currentUrl && sameOrigin(url, entry.currentUrl)) return;

    event.preventDefault();
    if (entry.automationActive) {
      logger.debug(`Blocked off-origin navigation during automation: ${url}`);
      return;
    }
    logger.debug(`Opening off-origin preview navigation externally: ${url}`);
    openExternally(url);
  };
  contents.on("will-navigate", restrictNavigation);
  contents.on("will-redirect", restrictNavigation);

  const publishNavigationState = () => emitNavigationState(window, entry);
  const publishStoppedLoadingState = () => {
    publishNavigationState();
    void capturePreviewScreenshot(window, key, entry);
  };
  contents.on("did-navigate", publishNavigationState);
  contents.on("did-navigate-in-page", publishNavigationState);
  contents.on("did-start-loading", publishNavigationState);
  contents.on("did-stop-loading", publishStoppedLoadingState);

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      safeSend(window.webContents, previewViewEvents.loadFailed.channel, {
        errorCode,
        errorDescription,
        url: validatedURL,
      });
    },
  );

  window.contentView.addChildView(view);

  // The host renderer navigating away (a dev-mode reload, for instance) tears
  // down the React tree without running cleanup, which would otherwise leave
  // this view floating over a renderer that no longer knows about it.
  const onHostNavigation = (
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || isInPlace) return;
    destroyEntry(key, window);
  };
  const onWindowClosed = () => destroyEntry(key, window);

  window.webContents.on("did-start-navigation", onHostNavigation);
  window.once("closed", onWindowClosed);

  entry.disposeHostHooks = () => {
    if (window.isDestroyed()) return;
    window.webContents.removeListener("did-start-navigation", onHostNavigation);
    window.removeListener("closed", onWindowClosed);
  };

  entries.set(key, entry);
  // The interval starts only once an overlay needs the fallback; the
  // did-stop-loading capture above seeds the cache so the first frame the
  // renderer paints isn't blank.
  return entry;
}

function destroyEntry(key: number, window: BrowserWindow): void {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  stopScreenshotCapture(entry);

  if (entry.automationActive) {
    // The window closed or the host navigated mid-run: the driving test is
    // about to fail, so let the runner explain why rather than reporting a
    // bare CDP disconnect.
    const notify = entry.onAutomationViewDestroyed;
    entry.automationActive = false;
    entry.onAutomationViewDestroyed = null;
    try {
      notify?.();
    } catch (error) {
      logger.warn("Preview automation destroy callback failed:", error);
    }
  }

  try {
    entry.disposeHostHooks();
  } catch (error) {
    logger.warn("Failed to remove preview view host hooks:", error);
  }

  try {
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(entry.view);
    }
  } catch (error) {
    logger.warn("Failed to detach preview view:", error);
  }

  try {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  } catch (error) {
    logger.warn("Failed to close preview view webContents:", error);
  }

  // Electron has no Session.destroy() API. Closing the partition's only
  // WebContents and never reusing its UUID makes the in-memory profile
  // unreachable; clearing it as well eagerly drops cookies, local storage,
  // IndexedDB, service workers, and the rest of the test user's browser state.
  try {
    void entry.session.clearStorageData().catch((error) => {
      logger.warn("Failed to clear isolated preview session:", error);
    });
  } catch (error) {
    logger.warn("Failed to clear isolated preview session:", error);
  }
}

/**
 * Shows the preview view for `window`, creating it on first call.
 *
 * Idempotent: repeated calls with the same URL only re-apply bounds, so the
 * renderer can call this freely on remount without reloading the app.
 */
export function showPreviewView(
  window: BrowserWindow,
  { url, bounds }: { url: string; bounds: PreviewViewBounds },
): void {
  if (!isSupportedPreviewUrl(url)) {
    // The contract only validates z.string().url(), so schemes like file: reach
    // here. This is an expected input rejection, not a product fault: a bare
    // Error would be forwarded to sendTelemetryException by createTypedHandler.
    throw new DyadError(
      `Unsupported preview URL: ${url}`,
      DyadErrorKind.Validation,
    );
  }

  const key = resolveKey(window);
  if (key === null) return;

  const entry = entries.get(key) ?? createEntry(window, key);

  if (entry.automationActive && entry.currentUrl !== url) {
    // A test is driving this page. Navigating it away — the renderer does
    // exactly that when the user switches apps mid-run — would leave the run
    // typing into the wrong app instead of failing honestly. Automation owns
    // the view until it ends, so nothing here applies: re-showing it would
    // paint the run's page over the app the renderer is now laying out, and
    // clearing `hiddenDuringAutomation` would strand the view past teardown.
    // A later show() with a different URL still navigates, because currentUrl
    // is deliberately left as it is.
    logger.warn(
      `Ignoring preview navigation to ${url} while tests are driving the view.`,
    );
    return;
  }

  if (entry.hiddenDuringAutomation) {
    entry.hiddenDuringAutomation = false;
    try {
      entry.view.setVisible(!entry.overlayActive);
    } catch (error) {
      logger.warn("Failed to re-show preview view after automation:", error);
    }
  }

  const roundedBounds = roundBounds(bounds);
  entry.bounds = roundedBounds;
  entry.view.setBounds(roundedBounds);

  if (entry.currentUrl !== url) {
    entry.currentUrl = url;
    void entry.view.webContents.loadURL(url).catch((error) => {
      // A superseded load rejects with ERR_ABORTED; did-fail-load reports the
      // failures that actually matter to the user.
      logger.debug(
        `Preview view load settled with an error for ${url}:`,
        error,
      );
    });
  } else {
    // Remounted renderer: replay current state so the toolbar isn't blank.
    emitNavigationState(window, entry);
  }
}

export function setPreviewViewBounds(
  window: BrowserWindow,
  bounds: PreviewViewBounds,
): void {
  const entry = getEntry(window);
  if (!entry) return;

  try {
    const roundedBounds = roundBounds(bounds);
    entry.bounds = roundedBounds;
    entry.view.setBounds(roundedBounds);
  } catch (error) {
    logger.warn("Failed to set preview view bounds:", error);
  }
}

export function setPreviewViewOverlayActive(
  window: BrowserWindow,
  active: boolean,
): void {
  const entry = getEntry(window);
  if (!entry) return;

  const key = resolveKey(window);
  entry.overlayActive = active;
  if (active) {
    // Replay the cache so the fallback paints immediately, then keep it fresh
    // for as long as the overlay covers the native surface.
    emitScreenshot(window, entry.latestScreenshotDataUrl);
    if (key !== null) {
      void capturePreviewScreenshot(window, key, entry);
      startScreenshotCapture(window, key, entry);
    }
  } else {
    pauseScreenshotCapture(entry);
  }

  try {
    entry.view.setVisible(!active && !entry.hiddenDuringAutomation);
  } catch (error) {
    logger.warn("Failed to update preview view overlay visibility:", error);
  }
}

export function hidePreviewView(window: BrowserWindow): void {
  const key = resolveKey(window);
  if (key === null) return;

  const entry = entries.get(key);
  if (entry && isClaimedForAutomation(key, entry)) {
    // Destroying now would kill the page a running test is driving — or is
    // about to, while the run is still setting up — for instance when the user
    // opens the Tests tab to watch progress, which unmounts the preview
    // component. Keep it alive but invisible; automation teardown destroys it
    // if the renderer never asked for it back.
    entry.hiddenDuringAutomation = true;
    try {
      entry.view.setVisible(false);
    } catch (error) {
      logger.warn("Failed to hide preview view during automation:", error);
    }
    return;
  }

  destroyEntry(key, window);
}

function withLiveContents(
  window: BrowserWindow,
  action: (contents: Electron.WebContents) => void,
): void {
  const entry = getEntry(window);
  if (!entry) return;
  if (entry.automationActive) {
    // Back/Forward/Reload stay on screen while a run drives the view, and one
    // click would navigate the page out from under Playwright — a wall of
    // "Target closed" failures blamed on the user's app. Same reasoning as the
    // navigation guard in showPreviewView.
    logger.warn(
      "Ignoring preview navigation while tests are driving the view.",
    );
    return;
  }
  const contents = entry.view.webContents;
  if (contents.isDestroyed()) return;

  try {
    action(contents);
  } catch (error) {
    logger.warn("Preview view navigation command failed:", error);
  }
}

export function previewViewGoBack(window: BrowserWindow): void {
  withLiveContents(window, (contents) => {
    if (contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack();
    }
  });
}

export function previewViewGoForward(window: BrowserWindow): void {
  withLiveContents(window, (contents) => {
    if (contents.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward();
    }
  });
}

export function previewViewReload(window: BrowserWindow): void {
  withLiveContents(window, (contents) => contents.reload());
}

export interface PreviewViewStatus {
  exists: boolean;
  currentUrl: string | null;
  automationActive: boolean;
  isLoading: boolean;
}

/**
 * The URL the view has actually committed to, rather than the one it was last
 * asked for. `entry.currentUrl` is assigned synchronously before `loadURL` even
 * starts, so a caller waiting for the page to be ready would otherwise be told
 * yes while it is still on about:blank.
 */
function committedUrl(entry: PreviewViewEntry): string | null {
  try {
    return entry.view.webContents.getURL() || null;
  } catch {
    // Contents already gone; the requested URL is the best we can say.
    return entry.currentUrl;
  }
}

function isLoading(entry: PreviewViewEntry): boolean {
  try {
    return entry.view.webContents.isLoading();
  } catch {
    return false;
  }
}

export function getPreviewViewStatus(window: BrowserWindow): PreviewViewStatus {
  const entry = getEntry(window);
  return {
    exists: !!entry,
    currentUrl: entry ? committedUrl(entry) : null,
    automationActive: !!entry?.automationActive,
    isLoading: entry ? isLoading(entry) : false,
  };
}

/**
 * Waits until this window's preview view has finished loading `url`.
 *
 * Matches on origin rather than the exact string: the isolated-test-database
 * path restarts the dev server before a run, which can churn the renderer's
 * URL (and trailing slashes differ between the two sides). Reads the committed
 * URL and waits for loading to settle, so a cold start after an isolation
 * restart can't report ready while the page is still coming up — the run would
 * attach CDP to a half-built or error page and blame the user's app.
 *
 * Honors `signal` so a Stop during the wait ends the run promptly instead of
 * sitting out the full timeout and then reporting a preview problem.
 */
export async function waitForPreviewView(
  window: BrowserWindow,
  {
    url,
    timeoutMs = 15_000,
    pollMs = 250,
    signal,
  }: {
    url: string;
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ ok: true } | { ok: false; reason: string; aborted?: boolean }> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (signal?.aborted) {
      return { ok: false, reason: "the run was stopped", aborted: true };
    }

    const status = getPreviewViewStatus(window);
    if (
      status.currentUrl &&
      sameOrigin(status.currentUrl, url) &&
      !status.isLoading
    ) {
      return { ok: true };
    }

    if (Date.now() >= deadline) {
      if (status.currentUrl && sameOrigin(status.currentUrl, url)) {
        return {
          ok: false,
          reason: `it is still loading ${status.currentUrl}`,
        };
      }
      return {
        ok: false,
        reason: status.exists
          ? `it is showing ${status.currentUrl ?? "nothing"}`
          : "the native preview isn't open",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Marks this window's preview view as driven by a test run. Returns null when
 * there is no live view, so the caller can fail the run before spawning.
 */
export interface PreviewAutomationSession {
  /** Replace the driven page with a fresh in-memory Electron session. */
  rotate: (options: {
    url: string;
  }) => { ok: true } | { ok: false; reason: string };
  end: () => void;
}

export function beginPreviewAutomation(
  window: BrowserWindow,
  { onViewDestroyed }: { onViewDestroyed?: () => void } = {},
): PreviewAutomationSession | null {
  const key = resolveKey(window);
  if (key === null) return null;

  const entry = entries.get(key);
  if (!entry) return null;

  entry.automationActive = true;
  // `hiddenDuringAutomation` is deliberately left as it is: the reservation
  // taken before setup may already have absorbed a hide, and clearing it here
  // would strand an invisible view that teardown then declines to destroy.
  entry.onAutomationViewDestroyed = onViewDestroyed ?? null;

  let activeEntry = entry;
  let ended = false;
  return {
    rotate: ({ url }) => {
      if (ended) {
        return { ok: false, reason: "preview automation already ended" };
      }
      if (!isSupportedPreviewUrl(url)) {
        return { ok: false, reason: `unsupported preview URL: ${url}` };
      }

      const current = entries.get(key);
      if (current !== activeEntry) {
        return {
          ok: false,
          reason: "the native preview was destroyed during the test run",
        };
      }
      if (!current.bounds) {
        return {
          ok: false,
          reason: "the native preview has no layout bounds",
        };
      }

      const bounds = current.bounds;
      const hiddenDuringAutomation = current.hiddenDuringAutomation;
      const overlayActive = current.overlayActive;

      // This destruction is deliberate. Disarm the callback so it remains a
      // signal for user/window lifecycle interruptions only.
      current.automationActive = false;
      current.onAutomationViewDestroyed = null;
      destroyEntry(key, window);

      if (resolveKey(window) !== key) {
        return { ok: false, reason: "the Dyad window was closed" };
      }

      const replacement = createEntry(window, key);
      replacement.automationActive = true;
      replacement.hiddenDuringAutomation = hiddenDuringAutomation;
      replacement.onAutomationViewDestroyed = onViewDestroyed ?? null;
      replacement.overlayActive = overlayActive;
      replacement.bounds = bounds;
      replacement.view.setBounds(bounds);
      replacement.view.setVisible(!overlayActive && !hiddenDuringAutomation);
      replacement.currentUrl = url;
      void replacement.view.webContents.loadURL(url).catch((error) => {
        logger.debug(
          `Rotated preview view load settled with an error for ${url}:`,
          error,
        );
      });
      activeEntry = replacement;
      return { ok: true };
    },
    end: () => {
      if (ended) return;
      ended = true;

      const current = entries.get(key);
      if (current !== activeEntry) return;

      current.automationActive = false;
      current.onAutomationViewDestroyed = null;

      if (current.hiddenDuringAutomation) {
        // The renderer asked to hide while we held the view open; honor it now.
        current.hiddenDuringAutomation = false;
        destroyEntry(key, window);
      }
    },
  };
}

/** Test-only: drops all tracked views without touching Electron objects. */
export function resetPreviewViewsForTesting(): void {
  for (const entry of entries.values()) {
    stopScreenshotCapture(entry);
  }
  entries.clear();
  automationReservations.clear();
}
