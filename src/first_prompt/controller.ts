import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import type {
  FirstPromptCommand,
  FirstPromptEvent,
  FirstPromptState,
} from "./state";
import { transition } from "./transition";

export interface FirstPromptCommandRunner {
  run(
    command: FirstPromptCommand,
    emit: (event: FirstPromptEvent) => void,
  ): void | Promise<void>;
  dispose?(): void;
}

export interface FirstPromptControllerOptions {
  runner: FirstPromptCommandRunner;
  observer?: TransitionObserver<
    FirstPromptState,
    FirstPromptEvent,
    FirstPromptCommand
  >;
  onDispose?: () => void;
}

/**
 * Root-owned single-key controller. Commands run serially so create,
 * post-create, settle, refresh, and navigation cannot overtake one another.
 * Events remain synchronous; single-flight therefore closes the voice-stop
 * await gap before a second submit can start another create command.
 */
export class FirstPromptController {
  private readonly store = new SnapshotStore<FirstPromptState>({
    type: "idle",
  });
  private readonly commandQueue: FirstPromptCommand[] = [];
  private draining = false;
  private disposed = false;

  constructor(private readonly options: FirstPromptControllerOptions) {}

  getSnapshot = this.store.getSnapshot;

  subscribe = this.store.subscribe;

  send = (event: FirstPromptEvent): boolean => {
    if (this.disposed) return false;
    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.options.observer, previous, event, result);
    if (result.ignoredReason !== undefined) return false;
    this.store.setState(result.state);
    if (result.commands.length > 0) {
      this.commandQueue.push(...result.commands);
      void this.drain();
    }
    return true;
  };

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.disposed && this.commandQueue.length > 0) {
        const command = this.commandQueue.shift()!;
        try {
          await this.options.runner.run(command, this.send);
        } catch (error) {
          if (this.disposed) return;
          console.error(
            `[first-prompt] command "${command.type}" threw`,
            error,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.commandQueue.length = 0;
    this.options.runner.dispose?.();
    this.store.dispose();
    this.options.onDispose?.();
  }
}
