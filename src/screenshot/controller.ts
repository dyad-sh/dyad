import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import {
  INITIAL_SCREENSHOT_STATE,
  type ScreenshotCommand,
  type ScreenshotEvent,
  type ScreenshotIgnoreReason,
  type ScreenshotState,
} from "./state";
import { transition } from "./transition";

export interface ScreenshotCommandRunner {
  execute(
    appId: number,
    command: ScreenshotCommand,
    emit: (event: ScreenshotEvent) => void,
  ): void;
  disposeKey(appId: number): void;
}

export class ScreenshotController {
  private readonly store = new SnapshotStore<ScreenshotState>(
    INITIAL_SCREENSHOT_STATE,
  );
  private disposed = false;

  constructor(
    readonly appId: number,
    private readonly runner: ScreenshotCommandRunner,
    private readonly observer?: TransitionObserver<
      ScreenshotState,
      ScreenshotEvent,
      ScreenshotCommand,
      ScreenshotIgnoreReason
    >,
  ) {}

  getSnapshot = this.store.getSnapshot;
  subscribe = this.store.subscribe;

  send = (event: ScreenshotEvent): void => {
    if (this.disposed) return;
    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.observer, previous, event, result);
    if (result.kind === "ignored") return;
    const execute = () => {
      for (const command of result.commands) {
        try {
          this.runner.execute(this.appId, command, this.send);
        } catch (error) {
          console.error(
            `Screenshot command execution failed for app ${this.appId}:`,
            error,
          );
          this.send({ type: "SAVE_FAILED" });
        }
      }
    };
    if (result.state !== previous) this.store.setState(result.state, execute);
    else execute();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runner.disposeKey(this.appId);
    this.store.dispose();
  }
}
