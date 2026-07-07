/**
 * installRendererIpcBridge — the "hybrid" half of the chat-flow harness.
 *
 * Installs a fake `window.electron` (the same surface `src/preload.ts` exposes
 * via contextBridge) that is wired DIRECTLY to the real main-process ipcMain
 * handlers captured by `src/testing/electron_mock.ts`. This lets the real
 * React renderer (mounted with React Testing Library under happy-dom) drive
 * the real `chat:stream` / `chat:get` / `settings:get` handlers in the same
 * Node process, and receive the real streamed events back.
 *
 * Shape notes (mirrors preload.ts exactly):
 *  - `invoke(channel, ...args)` unwraps the dyad IPC envelope, like preload.
 *  - `invokeEnvelope(channel, ...args)` returns the raw envelope (the
 *    contract-generated clients prefer this and unwrap themselves).
 *  - `on(channel, listener)` returns an unsubscribe fn, and the listener is
 *    called WITHOUT the Electron event arg — preload strips it
 *    (`(_event, ...args) => listener(...args)`), so we deliver `payload`
 *    directly.
 *  - Main-process `event.sender.send(channel, payload)` fans out to every
 *    subscribed renderer listener, matching webContents.send -> ipcRenderer.on.
 *
 * The bridge does NOT validate channels against the preload whitelist — the
 * real handlers are the source of truth. Unknown channels reject with a clear
 * error (collected in `missingChannels` for diagnostics).
 */
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import type { ElectronMockShared } from "./electron_mock";

type Listener = (...args: unknown[]) => void;

export interface InstallRendererIpcBridgeOptions {
  /**
   * Wraps every main->renderer event dispatch. The hybrid harness passes React
   * Testing Library's `act` so the renderer state updates driven by async IPC
   * events (stream chunks etc.) don't trip "not wrapped in act(...)" warnings.
   * Defaults to calling the dispatch directly (bridge stays React-agnostic).
   */
  wrapDispatch?: (dispatch: () => void) => void;
}

export interface RendererIpcBridge {
  /** Simulate a main->renderer push (webContents.send). */
  send: (channel: string, ...args: unknown[]) => void;
  /** The fake IpcMainInvokeEvent handed to every invoked handler. */
  fakeEvent: {
    sender: {
      isDestroyed: () => boolean;
      isCrashed: () => boolean;
      send: (channel: string, ...args: unknown[]) => void;
    };
  };
  /** Channels invoked by the renderer that had no registered handler. */
  missingChannels: Set<string>;
  /** Every event delivered to the renderer, for debugging/assertions. */
  sentEvents: Array<{ channel: string; args: unknown[] }>;
  /**
   * Resolve once every in-flight `invoke`/`invokeEnvelope` has settled. Teardown
   * must await this BEFORE closing the db: the UI fires background queries
   * (proposals, token counts, codebase scans) whose handlers read the db, and a
   * promise still resolving after `closeDatabase()` throws "Database not
   * initialized". Also flushes any listener that re-invokes on an event.
   */
  settleInFlight: (timeoutMs?: number) => Promise<void>;
  /** Number of `invoke` calls that have not yet resolved. */
  readonly pendingCount: number;
  /** Remove the fake window.electron. */
  uninstall: () => void;
}

export function installRendererIpcBridge(
  shared: ElectronMockShared,
  options: InstallRendererIpcBridgeOptions = {},
): RendererIpcBridge {
  if (!shared?.ipcHandlers) {
    throw new Error(
      "installRendererIpcBridge requires the hoisted electron-mock shared " +
        "object (the one passed to vi.mock('electron')).",
    );
  }

  const listeners = new Map<string, Set<Listener>>();
  const missingChannels = new Set<string>();
  const sentEvents: Array<{ channel: string; args: unknown[] }> = [];
  const inFlight = new Set<Promise<unknown>>();
  const dispatchWrapper =
    options.wrapDispatch ?? ((dispatch: () => void) => dispatch());

  const send = (channel: string, ...args: unknown[]) => {
    sentEvents.push({ channel, args });
    const subs = listeners.get(channel);
    if (!subs) return;
    dispatchWrapper(() => {
      // Copy (Array.from, not spread, so `oxlint --fix` can't strip it): a
      // listener may unsubscribe or subscribe during dispatch.
      for (const cb of Array.from(subs)) {
        cb(...args);
      }
    });
  };

  // The fake IpcMainInvokeEvent. Its sender.send IS the renderer event bus:
  // main-process code calling `event.sender.send(...)` (e.g. safeSend in
  // chat_stream_handlers) lands directly in window.electron listeners.
  const fakeEvent = {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send,
    },
  };

  const invokeRaw = (channel: string, ...args: unknown[]) => {
    const handler = shared.ipcHandlers.get(channel);
    if (!handler) {
      missingChannels.add(channel);
      return Promise.reject(
        new Error(
          `[renderer-ipc-bridge] no ipcMain handler registered for '${channel}'`,
        ),
      );
    }
    const promise = Promise.resolve(handler(fakeEvent, ...(args as [unknown])));
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    return promise;
  };

  const ipcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const response = await invokeRaw(channel, ...args);
      return isIpcInvokeEnvelope(response)
        ? unwrapIpcEnvelope(response)
        : response;
    },
    invokeEnvelope: (channel: string, ...args: unknown[]) =>
      invokeRaw(channel, ...args),
    on: (channel: string, listener: Listener) => {
      let subs = listeners.get(channel);
      if (!subs) {
        subs = new Set();
        listeners.set(channel, subs);
      }
      subs.add(listener);
      return () => {
        subs.delete(listener);
      };
    },
    removeListener: (channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener);
    },
    removeAllListeners: (channel: string) => {
      listeners.delete(channel);
    },
  };

  const electron = {
    ipcRenderer,
    webFrame: {
      setZoomFactor: (_factor: number) => {},
      getZoomFactor: () => 1,
    },
  };

  (
    globalThis as unknown as { window: { electron?: unknown } }
  ).window.electron = electron;

  const settleInFlight = async (timeoutMs = 5_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    // A settling invoke can schedule follow-up invokes (a query's onSuccess,
    // a dependent query), so drain repeatedly until the set stays empty.
    while (inFlight.size > 0) {
      if (Date.now() > deadline) {
        return;
      }
      await Promise.allSettled(inFlight);
    }
  };

  return {
    send,
    fakeEvent,
    missingChannels,
    sentEvents,
    settleInFlight,
    get pendingCount() {
      return inFlight.size;
    },
    uninstall: () => {
      const win = (globalThis as unknown as { window: { electron?: unknown } })
        .window;
      if (win.electron === electron) {
        delete win.electron;
      }
      listeners.clear();
    },
  };
}
