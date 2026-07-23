import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import type { GithubOpsCommandRunner } from "./commands";
import {
  INITIAL_GITHUB_OPS_STATE,
  type GithubOpsCommand,
  type GithubOpsEvent,
  type GithubOpsState,
} from "./state";
import { transition } from "./transition";

/** Per-app controller. Main-process locking provides cross-producer exclusion. */
export class GithubOpsController {
  private readonly store = new SnapshotStore<GithubOpsState>(
    INITIAL_GITHUB_OPS_STATE,
  );
  private readonly pendingEvents: GithubOpsEvent[] = [];
  private processing = false;
  private disposed = false;

  constructor(
    readonly appId: number,
    private readonly runner: GithubOpsCommandRunner,
    private readonly observer?: TransitionObserver<
      GithubOpsState,
      GithubOpsEvent,
      GithubOpsCommand
    >,
  ) {}

  getSnapshot = this.store.getSnapshot;

  subscribe = this.store.subscribe;

  send = (event: GithubOpsEvent): void => {
    if (this.disposed) return;
    this.pendingEvents.push(event);
    if (this.processing) return;
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        const previous = this.store.getSnapshot();
        const result = transition(previous, next);
        observeTransition(this.observer, previous, next, result);
        if (result.state !== previous) this.store.setState(result.state);
        for (const command of result.commands) {
          this.run(command);
        }
      }
    } finally {
      this.processing = false;
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingEvents.length = 0;
    this.store.dispose();
  }

  private run(command: GithubOpsCommand): void {
    try {
      this.runner.run(this.appId, command, this.send);
    } catch (error) {
      console.error(
        `github_ops command execution failed for app ${this.appId}:`,
        error,
      );
    }
  }
}
