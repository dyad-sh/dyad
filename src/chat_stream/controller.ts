import type { ChatStreamCommands } from "./commands";
import type {
  ChatStreamInvocationRef,
  ChatStreamIgnoreReason,
  StreamCommand,
  StreamEvent,
  StreamState,
} from "./state";
import { CHAT_STREAM_INVOCATION_KIND } from "./state";
import {
  initialStreamState,
  streamInvocationRef,
  transition,
} from "./transition";
import type { IdSource } from "@/state_machines/clock";
import {
  createInvocationRef,
  sameInvocationRef,
} from "@/state_machines/invocation_ref";
import { createLifecycleScope } from "@/state_machines/lifecycle_scope";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";

/**
 * Per-chat driver for the chat stream machine.
 *
 * Owns the current state, feeds events through the pure `transition`
 * function, and executes the returned commands SERIALLY through the injected
 * `ChatStreamCommands` adapter. Exposes the `useSyncExternalStore` contract
 * (`getSnapshot` / `subscribe`) with immutable snapshots.
 *
 * No timers, no retry logic: reconciliation is handled entirely by the
 * machine's states and the events the adapter emits back.
 */
export interface ChatStreamController {
  readonly chatId: number;
  getSnapshot(): StreamState;
  subscribe(listener: () => void): () => void;
  send(event: StreamEvent): void;
  /** True while queued commands are still executing. */
  isSettled(): boolean;
  /** True while any React subscriber is attached. */
  hasSubscribers(): boolean;
  /** Number of active snapshot subscribers, including owner subscriptions. */
  subscriberCount(): number;
  /** Permanently stop this controller and release renderer transport state. */
  dispose(): void;
}

export interface ChatStreamControllerOptions {
  chatId: number;
  idSource: IdSource;
  /** Read fresh on every command so tests / the runtime can swap adapters. */
  getCommands: () => ChatStreamCommands;
  /** Invoked whenever the controller becomes fully quiescent (no pending commands). */
  onQuiescent?: (controller: ChatStreamController) => void;
  observer?: TransitionObserver<
    StreamState,
    StreamEvent,
    StreamCommand,
    ChatStreamIgnoreReason
  >;
}

export function createChatStreamController(
  options: ChatStreamControllerOptions,
): ChatStreamController {
  const { chatId, idSource, getCommands, onQuiescent, observer } = options;

  const store = new SnapshotStore<StreamState>(initialStreamState());
  const commandQueue: StreamCommand[] = [];
  let draining = false;
  let disposed = false;
  let disposalState: StreamState | undefined;
  let lateStartInvocationRef: ChatStreamInvocationRef | undefined;
  let lateStartCommands: ChatStreamCommands | undefined;

  const controller: ChatStreamController = {
    chatId,
    getSnapshot: store.getSnapshot,
    subscribe(listener) {
      const unsubscribe = store.subscribe(listener);
      return () => {
        unsubscribe();
        notifyQuiescentIfIdle();
      };
    },
    send,
    isSettled: () => !draining && commandQueue.length === 0,
    hasSubscribers: () => store.subscriberCount() > 0,
    subscriberCount: () => store.subscriberCount(),
    dispose,
  };
  const lifecycle = createLifecycleScope({
    stopAdmission() {
      disposed = true;
      commandQueue.length = 0;
      disposalState = store.getSnapshot();
    },
    settleWaiters() {
      const state = disposalState;
      if (!state || !isTransportOwned(state)) return;
      try {
        state.request.onSettled?.({ success: false });
      } catch (error) {
        console.error(
          `[chat-stream] Failed to settle disposed stream for chat ${chatId}:`,
          error,
        );
      }
    },
    publishFinalProjection() {
      const state = disposalState;
      if (!state || !isTransportOwned(state)) return;
      try {
        getCommands().syncProjection({
          chatId,
          state: { type: "idle" },
        });
      } catch (error) {
        console.error(
          `[chat-stream] Failed to clear projection for disposed chat ${chatId}:`,
          error,
        );
      }
    },
    releaseResources() {
      const state = disposalState;
      if (state && isTransportOwned(state)) {
        runSafely(() =>
          getCommands().releaseTransport({
            chatId,
            invocationRef: state.invocationRef,
          }),
        );
      }
      store.dispose();
    },
    onLateSettlement() {
      const invocationRef = lateStartInvocationRef;
      const commands = lateStartCommands;
      if (!invocationRef || !commands) return;
      runSafely(() => commands.releaseTransport({ chatId, invocationRef }));
    },
  });

  function notifyQuiescentIfIdle(): void {
    if (!disposed && controller.isSettled()) {
      onQuiescent?.(controller);
    }
  }

  function send(event: StreamEvent): void {
    const previous = store.getSnapshot();
    if (disposed) {
      observer?.onEventIgnored?.({
        state: previous,
        event,
        reason: "no-active-stream",
      });
      return;
    }

    const transitionEvent =
      event.type === "submit" &&
      (previous.type === "idle" || previous.type === "errored")
        ? {
            ...event,
            invocationRef: createInvocationRef(
              CHAT_STREAM_INVOCATION_KIND,
              chatId,
              idSource,
            ),
          }
        : event;
    const result = transition(previous, transitionEvent);
    observeTransition(observer, previous, transitionEvent, result);
    // ORDERING INVARIANT — send() can be re-entered synchronously while
    // setState below is still on the stack: syncProjection writes
    // isStreamingByIdAtom, plan_handoff's watch-stream-idle Jotai sub fires
    // synchronously on that write, and its start-implementation command
    // calls chatStream.submit(...) -> send() on this same controller
    // (plan-accept -> implement flow). That re-entry is only safe because
    // (a) applied commands are pushed to commandQueue BEFORE setState, so the
    // inner event's commands cannot overtake this event's, and (b)
    // SnapshotStore commits the snapshot BEFORE running this callback, so the
    // inner transition sees committed state. Do not reorder these lines
    // without adding a re-entrancy buffer (processing flag + pending-event
    // FIFO).
    const commands = result.kind === "applied" ? result.commands : [];
    commandQueue.push(...commands);
    store.setState(result.state, () => {
      // Keep the legacy isStreaming projection in lockstep with the machine
      // (single writer), then notify React subscribers.
      try {
        getCommands().syncProjection({ chatId, state: result.state });
      } catch (error) {
        console.error(
          `[chat-stream] Failed to sync projection for chat ${chatId}:`,
          error,
        );
      }
    });
    void drain();
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (!disposed && commandQueue.length > 0) {
        const command = commandQueue.shift()!;
        await execute(command);
      }
    } finally {
      draining = false;
      notifyQuiescentIfIdle();
    }
  }

  async function execute(command: StreamCommand): Promise<void> {
    const commands = getCommands();
    switch (command.type) {
      case "start-stream": {
        lateStartInvocationRef = command.invocationRef;
        lateStartCommands = commands;
        try {
          await lifecycle.trackPromise(
            commands.startStream({
              chatId,
              invocationRef: command.invocationRef,
              request: command.request,
              emit: send,
              isStale: () =>
                disposed ||
                !matchesActiveInvocation(
                  streamInvocationRef(store.getSnapshot()),
                  command.invocationRef,
                ),
            }),
          );
        } catch (error) {
          // Failures inside the stream (invoke rejection, IPC errors) come
          // back as stream-errored events from the client; this catches
          // setup failures (e.g. attachment conversion).
          send({
            type: "stream-errored",
            invocationRef: command.invocationRef,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case "enqueue-message": {
        runSafely(() =>
          commands.enqueueMessage({ chatId, request: command.request }),
        );
        return;
      }
      case "request-abort": {
        runSafely(() => commands.requestAbort({ chatId }));
        return;
      }
      case "run-end-side-effects": {
        let ok = true;
        try {
          await commands.runEndSideEffects({
            chatId,
            invocationRef: command.invocationRef,
            request: command.request,
            targetAppId: command.targetAppId,
            response: command.response,
          });
        } catch {
          // Already logged by the adapter; the machine still needs to return
          // to idle (without dispatching the queue).
          ok = false;
        }
        send({
          type: "finalize-complete",
          invocationRef: command.invocationRef,
          ok,
        });
        return;
      }
      case "run-error-side-effects": {
        runSafely(() =>
          commands.runErrorSideEffects({
            chatId,
            invocationRef: command.invocationRef,
            request: command.request,
            targetAppId: command.targetAppId,
            error: command.error,
            warningMessages: command.warningMessages,
          }),
        );
        return;
      }
      case "dispatch-next-queued": {
        runSafely(() => commands.dispatchNextQueued({ chatId, emit: send }));
        return;
      }
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }

  function runSafely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error(`[chat-stream] Command failed for chat ${chatId}:`, error);
    }
  }

  function dispose(): void {
    lifecycle.dispose();
  }

  function isTransportOwned(
    state: StreamState,
  ): state is Extract<
    StreamState,
    { type: "starting" | "streaming" | "cancelling" }
  > {
    return (
      state.type === "starting" ||
      state.type === "streaming" ||
      state.type === "cancelling"
    );
  }

  function matchesActiveInvocation(
    active: ChatStreamInvocationRef | undefined,
    expected: ChatStreamInvocationRef,
  ): boolean {
    return active !== undefined && sameInvocationRef(active, expected);
  }

  return controller;
}
