import type { ChatStreamCommands } from "./commands";
import type { StreamCommand, StreamEvent, StreamState } from "./state";
import { initialStreamState, transition } from "./transition";

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
}

export interface ChatStreamControllerOptions {
  chatId: number;
  /** Read fresh on every command so tests / the runtime can swap adapters. */
  getCommands: () => ChatStreamCommands;
  /** Invoked whenever the controller becomes fully quiescent (no pending commands). */
  onQuiescent?: (controller: ChatStreamController) => void;
}

export function createChatStreamController(
  options: ChatStreamControllerOptions,
): ChatStreamController {
  const { chatId, getCommands, onQuiescent } = options;

  let state: StreamState = initialStreamState();
  const listeners = new Set<() => void>();
  const commandQueue: StreamCommand[] = [];
  let draining = false;

  const controller: ChatStreamController = {
    chatId,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        notifyQuiescentIfIdle();
      };
    },
    send,
    isSettled: () => !draining && commandQueue.length === 0,
    hasSubscribers: () => listeners.size > 0,
  };

  function notify(): void {
    // Copy first: listeners may unsubscribe while being notified.
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  function notifyQuiescentIfIdle(): void {
    if (controller.isSettled()) {
      onQuiescent?.(controller);
    }
  }

  function send(event: StreamEvent): void {
    const result = transition(state, event);
    const changed = result.state !== state;
    state = result.state;
    commandQueue.push(...result.commands);
    if (changed) {
      // Keep the legacy isStreaming projection in lockstep with the machine
      // (single writer), then notify React subscribers.
      try {
        getCommands().syncProjection({ chatId, state });
      } catch (error) {
        console.error(
          `[chat-stream] Failed to sync projection for chat ${chatId}:`,
          error,
        );
      }
      notify();
    }
    void drain();
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (commandQueue.length > 0) {
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
        try {
          await commands.startStream({
            chatId,
            streamId: command.streamId,
            request: command.request,
            emit: send,
          });
        } catch (error) {
          // Failures inside the stream (invoke rejection, IPC errors) come
          // back as stream-errored events from the client; this catches
          // setup failures (e.g. attachment conversion).
          send({
            type: "stream-errored",
            streamId: command.streamId,
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
            streamId: command.streamId,
            request: command.request,
            response: command.response,
          });
        } catch {
          // Already logged by the adapter; the machine still needs to return
          // to idle (without dispatching the queue).
          ok = false;
        }
        send({ type: "finalize-complete", streamId: command.streamId, ok });
        return;
      }
      case "run-error-side-effects": {
        runSafely(() =>
          commands.runErrorSideEffects({
            chatId,
            streamId: command.streamId,
            request: command.request,
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

  return controller;
}
