import type { HandoffCommand, HandoffEvent, HandoffState } from "./state";
import { transition } from "./transition";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";

/**
 * Executes one command and may emit follow-up events via `emit`. Emission may
 * be synchronous (e.g. `watch-stream-idle` when the stream is already idle)
 * or arbitrarily later (e.g. `wait`). The production implementation lives in
 * `commands.ts`; tests substitute fakes.
 */
export interface HandoffCommandRunner {
  (
    command: HandoffCommand,
    emit: (event: HandoffEvent) => void,
  ): void | Promise<void>;
  disposeKey?(chatId: number): void;
  dispose?(): void;
}

export interface HandoffController {
  /** Current state. Stable reference between transitions. */
  getSnapshot(): HandoffState;
  /** Notifies whenever the state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Feed an event through the transition function and run its commands. */
  send(event: HandoffEvent): void;
  /** Permanently stop this controller and discard queued work. */
  dispose(): void;
}

const IDLE: HandoffState = { type: "idle" };

/**
 * Minimal runtime for the plan-handoff machine: holds the current state,
 * notifies subscribers on change, and executes commands strictly serially in
 * FIFO order. One controller manages one chat's handoff; overlapping accepts
 * for different chats get separate controllers (see the registry in
 * `usePlanHandoff.ts`).
 *
 * The controller is deliberately dumb: no retries, no timers, no knowledge of
 * atoms or IPC. All of that lives in the command runner.
 */
export function createHandoffController(
  runCommand: HandoffCommandRunner,
  observer?: TransitionObserver<HandoffState, HandoffEvent, HandoffCommand>,
): HandoffController {
  const store = new SnapshotStore<HandoffState>(IDLE);
  const queue: HandoffCommand[] = [];
  let draining = false;
  let disposed = false;

  function send(event: HandoffEvent): void {
    if (disposed) return;

    const previous = store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(observer, previous, event, result);
    if (result.kind === "ignored") return;
    store.setState(result.state);
    if (result.commands.length > 0) {
      queue.push(...result.commands);
      void drain();
    }
  }

  async function drain(): Promise<void> {
    if (draining) {
      // Already pumping; the running loop will pick up the new commands.
      return;
    }
    draining = true;
    try {
      while (!disposed && queue.length > 0) {
        const command = queue.shift()!;
        try {
          await runCommand(command, send);
        } catch (error) {
          if (disposed) return;
          // Command runners are expected to convert failures into events
          // (PLAN_PERSIST_FAILED etc.). A throw here is a programming error;
          // log it and keep the queue moving so one bad command cannot wedge
          // every later handoff step.
          console.error(
            `[plan-handoff] command "${command.type}" threw`,
            error,
          );
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    send,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      store.dispose();
    },
  };
}
