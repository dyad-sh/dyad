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
 * Fidelity: the bridge enforces the SAME channel whitelist preload does
 * (VALID_INVOKE_CHANNELS / VALID_RECEIVE_CHANNELS, throwing the same
 * "Invalid channel" error) and structured-clones invoke args, results, and
 * event payloads, matching Electron's serialization — a handler returning a
 * function or class instance fails here like it would in production. Unit
 * tests exercising bridge mechanics with synthetic channel names can pass
 * `validateChannels: false`. Whitelisted channels with no registered handler
 * still reject and are collected in `missingChannels` for diagnostics.
 */
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import {
  VALID_INVOKE_CHANNELS,
  VALID_RECEIVE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "@/ipc/preload/channels";
import type { ElectronMockShared } from "./electron_mock";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";

type Listener = (...args: unknown[]) => void;

export interface RendererIpcBridgeEvent {
  channel: string;
  args: unknown[];
}

export interface RendererIpcBridgeInvokeLogEntry {
  channel: string;
  args: unknown[];
  status: "pending" | "fulfilled" | "rejected";
  result?: unknown;
  error?: unknown;
  settledAt?: number;
}

type OncePredicate = (event: RendererIpcBridgeEvent) => boolean;

interface OnceWaiter {
  predicate?: OncePredicate;
  resolve: (event: RendererIpcBridgeEvent) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface InstallRendererIpcBridgeOptions {
  /**
   * Wraps every main->renderer event dispatch. The hybrid harness passes React
   * Testing Library's `act` so the renderer state updates driven by async IPC
   * events (stream chunks etc.) don't trip "not wrapped in act(...)" warnings.
   * Defaults to calling the dispatch directly (bridge stays React-agnostic).
   */
  wrapDispatch?: (dispatch: () => void) => void;
  /**
   * Enforce the preload channel whitelist (default true), throwing the same
   * `Invalid channel: <name>` error preload.ts throws. Bridge unit tests that
   * use synthetic channel names set false.
   */
  validateChannels?: boolean;
}

/** Mirrors preload.ts's dynamic terminal-stream allowance exactly. */
function isValidDynamicReceiveChannel(channel: string): boolean {
  return (
    channel.startsWith("terminal:data:") || channel.startsWith("terminal:exit:")
  );
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
  sentEvents: RendererIpcBridgeEvent[];
  /** Every renderer->main invoke, including result/error metadata. */
  invokeLog: RendererIpcBridgeInvokeLogEntry[];
  /** Resolve with the next matching main->renderer event. */
  once: (
    channel: string,
    predicate?: OncePredicate,
    timeoutMs?: number,
  ) => Promise<RendererIpcBridgeEvent>;
  /** Return the latest invoke log entry for `channel`, if any. */
  lastInvoke: (channel: string) => RendererIpcBridgeInvokeLogEntry | undefined;
  /** How many events on `channel` have been delivered so far. */
  eventCount: (channel: string) => number;
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

  configureTrustedRenderer({
    devServerUrl: "http://localhost:5173",
    packagedRendererUrl: "file:///app/renderer/main_window/index.html",
  });

  const listeners = new Map<string, Set<Listener>>();
  const onceWaiters = new Map<string, Set<OnceWaiter>>();
  const missingChannels = new Set<string>();
  const sentEvents: RendererIpcBridgeEvent[] = [];
  const invokeLog: RendererIpcBridgeInvokeLogEntry[] = [];
  const inFlight = new Map<Promise<unknown>, RendererIpcBridgeInvokeLogEntry>();
  const dispatchWrapper =
    options.wrapDispatch ?? ((dispatch: () => void) => dispatch());
  const validateChannels = options.validateChannels ?? true;

  // Same checks preload.ts performs, throwing the same error, so a channel
  // that would fail in the packaged app fails here too.
  const assertValidInvokeChannel = (channel: string) => {
    if (!validateChannels) return;
    if (!(VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
  };
  const assertValidSendChannel = (channel: string) => {
    if (!validateChannels) return;
    if (!(VALID_SEND_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
  };
  const isValidReceiveChannel = (channel: string): boolean =>
    !validateChannels ||
    (VALID_RECEIVE_CHANNELS as readonly string[]).includes(channel) ||
    isValidDynamicReceiveChannel(channel);

  // Electron structured-clones everything that crosses the process boundary.
  // Reproduce that: non-cloneable values (functions, class instances) throw
  // here exactly like "An object could not be cloned" would in production,
  // and mutation aliasing across the fake boundary is impossible.
  const cloneAcrossBoundary = <T>(value: T, context: string): T => {
    try {
      return structuredClone(value);
    } catch (error) {
      throw new Error(
        `[renderer-ipc-bridge] value for '${context}' is not structured-cloneable ` +
          `(real Electron IPC would throw "An object could not be cloned"): ${String(error)}`,
      );
    }
  };

  const removeOnceWaiter = (channel: string, waiter: OnceWaiter) => {
    const waiters = onceWaiters.get(channel);
    if (!waiters) return;
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    if (waiters.size === 0) {
      onceWaiters.delete(channel);
    }
  };

  const notifyOnceWaiters = (event: RendererIpcBridgeEvent) => {
    const waiters = onceWaiters.get(event.channel);
    if (!waiters) return;

    for (const waiter of Array.from(waiters)) {
      let matches = false;
      try {
        matches = waiter.predicate ? waiter.predicate(event) : true;
      } catch (error) {
        removeOnceWaiter(event.channel, waiter);
        waiter.reject(error);
        continue;
      }

      if (matches) {
        removeOnceWaiter(event.channel, waiter);
        waiter.resolve(event);
      }
    }
  };

  const send = (channel: string, ...args: unknown[]) => {
    // webContents.send structured-clones its payload; so do we.
    const event = {
      channel,
      args: cloneAcrossBoundary(args, `send ${channel}`),
    };
    sentEvents.push(event);
    const subs = listeners.get(channel);
    const waiters = onceWaiters.get(channel);
    if (!subs?.size && !waiters?.size) return;
    dispatchWrapper(() => {
      notifyOnceWaiters(event);
      // Copy (Array.from, not spread, so `oxlint --fix` can't strip it): a
      // listener may unsubscribe or subscribe during dispatch.
      for (const cb of Array.from(subs ?? [])) {
        cb(...args);
      }
    });
  };

  // The fake IpcMainInvokeEvent. Its sender.send IS the renderer event bus:
  // main-process code calling `event.sender.send(...)` (e.g. safeSend in
  // chat_stream_handlers) lands directly in window.electron listeners.
  const frame = { url: "http://localhost:5173/" };
  const fakeEvent = {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send,
    },
    senderFrame: frame,
  };

  // The renderer's one-way `ipcRenderer.send`: fans out to the ipcMain.on
  // listeners captured by the electron mock, matching preload's `send` ->
  // main's `ipcMain.on`. Fire-and-forget, so there's no reply to await.
  const sendToMain = (channel: string, ...args: unknown[]) => {
    assertValidSendChannel(channel);
    const clonedArgs = cloneAcrossBoundary(args, `send-to-main ${channel}`);
    const subs = shared.ipcListeners?.get(channel);
    if (!subs?.length) return;
    for (const listener of Array.from(subs)) {
      listener(fakeEvent, ...clonedArgs);
    }
  };

  const invokeRaw = (channel: string, ...args: unknown[]) => {
    assertValidInvokeChannel(channel);
    // ipcRenderer.invoke structured-clones args main-ward and the result
    // renderer-ward; reproduce both directions.
    const clonedArgs = cloneAcrossBoundary(args, `invoke ${channel} args`);
    const entry: RendererIpcBridgeInvokeLogEntry = {
      channel,
      args: clonedArgs,
      status: "pending",
    };
    invokeLog.push(entry);

    const handler = shared.ipcHandlers.get(channel);
    if (!handler) {
      missingChannels.add(channel);
      const error = new Error(
        `[renderer-ipc-bridge] no ipcMain handler registered for '${channel}'`,
      );
      entry.status = "rejected";
      entry.error = error;
      entry.settledAt = Date.now();
      return Promise.reject(error);
    }
    let promise: Promise<unknown>;
    try {
      promise = Promise.resolve(
        handler(fakeEvent, ...(clonedArgs as [unknown])),
      ).then((result) =>
        cloneAcrossBoundary(result, `invoke ${channel} result`),
      );
    } catch (error) {
      promise = Promise.reject(error);
    }

    inFlight.set(promise, entry);
    void promise.then(
      (result) => {
        entry.status = "fulfilled";
        entry.result = result;
        entry.settledAt = Date.now();
        inFlight.delete(promise);
      },
      (error) => {
        entry.status = "rejected";
        entry.error = error;
        entry.settledAt = Date.now();
        inFlight.delete(promise);
      },
    );
    return promise;
  };

  const ipcRenderer = {
    // Not async: preload's invoke throws synchronously on an invalid channel,
    // and invokeRaw's whitelist check must propagate the same way.
    invoke: (channel: string, ...args: unknown[]) =>
      invokeRaw(channel, ...args).then((response) =>
        isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response,
      ),
    invokeEnvelope: (channel: string, ...args: unknown[]) =>
      invokeRaw(channel, ...args),
    send: (channel: string, ...args: unknown[]) => sendToMain(channel, ...args),
    on: (channel: string, listener: Listener) => {
      if (!isValidReceiveChannel(channel)) {
        // Same behavior as preload.ts's `on`.
        throw new Error(`Invalid channel: ${channel}`);
      }
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
    // preload.ts silently ignores invalid channels for the removal APIs.
    removeListener: (channel: string, listener: Listener) => {
      if (!isValidReceiveChannel(channel)) return;
      listeners.get(channel)?.delete(listener);
    },
    removeAllListeners: (channel: string) => {
      if (!isValidReceiveChannel(channel)) return;
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

  const once = (
    channel: string,
    predicate?: OncePredicate,
    timeoutMs = 20_000,
  ): Promise<RendererIpcBridgeEvent> =>
    new Promise((resolve, reject) => {
      const waiter: OnceWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          removeOnceWaiter(channel, waiter);
          reject(
            new Error(
              `[renderer-ipc-bridge] timed out waiting for event '${channel}'`,
            ),
          );
        }, timeoutMs),
      };

      const waiters = onceWaiters.get(channel) ?? new Set<OnceWaiter>();
      waiters.add(waiter);
      onceWaiters.set(channel, waiters);
    });

  const waitForBatchOrTimeout = (
    batch: Promise<unknown>[],
    timeoutMs: number,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void Promise.allSettled(batch).then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  const pendingChannels = (): string[] =>
    Array.from(inFlight.values()).map((entry) => entry.channel);

  const settleTimeoutError = (timeoutMs: number) =>
    new Error(
      `[renderer-ipc-bridge] settleInFlight timed out after ${timeoutMs}ms; ` +
        `pending channels: ${JSON.stringify(pendingChannels())}. A hung ` +
        `handler at teardown is a real bug — do not close the db under it.`,
    );

  const settleInFlight = async (timeoutMs = 5_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    // A settling invoke can schedule follow-up invokes (a query's onSuccess,
    // a dependent query), so drain repeatedly until the set stays empty.
    // On timeout this THROWS (listing the stuck channels) instead of
    // returning: a silent success here made a deadlocked handler
    // indistinguishable from a clean teardown.
    while (inFlight.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw settleTimeoutError(timeoutMs);
      }
      const didSettle = await waitForBatchOrTimeout(
        Array.from(inFlight.keys()),
        remainingMs,
      );
      if (!didSettle && inFlight.size > 0) {
        throw settleTimeoutError(timeoutMs);
      }
    }
  };

  const clearOnceWaiters = () => {
    for (const waiters of Array.from(onceWaiters.values())) {
      for (const waiter of Array.from(waiters)) {
        clearTimeout(waiter.timer);
      }
    }
    onceWaiters.clear();
  };

  const lastInvoke = (
    channel: string,
  ): RendererIpcBridgeInvokeLogEntry | undefined => {
    for (let i = invokeLog.length - 1; i >= 0; i--) {
      if (invokeLog[i].channel === channel) {
        return invokeLog[i];
      }
    }
    return undefined;
  };

  return {
    send,
    fakeEvent,
    missingChannels,
    sentEvents,
    invokeLog,
    once,
    lastInvoke,
    eventCount: (channel: string) =>
      sentEvents.filter((event) => event.channel === channel).length,
    settleInFlight,
    get pendingCount() {
      return inFlight.size;
    },
    uninstall: () => {
      clearOnceWaiters();
      const win = (globalThis as unknown as { window: { electron?: unknown } })
        .window;
      if (win.electron === electron) {
        delete win.electron;
      }
      listeners.clear();
    },
  };
}
