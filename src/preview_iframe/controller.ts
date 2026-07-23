import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import {
  INITIAL_PREVIEW_IFRAME_STATE,
  type PreviewIframeCommand,
  type PreviewIframeEvent,
  type PreviewIframeIgnoreReason,
  type PreviewIframeState,
} from "./state";
import { transition } from "./transition";

export interface PreviewIframeCommandRunner {
  execute(
    appId: number,
    command: PreviewIframeCommand,
    emit: (event: PreviewIframeEvent) => void,
  ): void;
}

export class PreviewIframeController {
  private readonly store = new SnapshotStore<PreviewIframeState>(
    INITIAL_PREVIEW_IFRAME_STATE,
  );
  private disposed = false;

  constructor(
    readonly appId: number,
    private readonly runner: PreviewIframeCommandRunner,
    private readonly observer?: TransitionObserver<
      PreviewIframeState,
      PreviewIframeEvent,
      PreviewIframeCommand,
      PreviewIframeIgnoreReason
    >,
  ) {}

  getSnapshot = this.store.getSnapshot;
  subscribe = this.store.subscribe;

  send = (event: PreviewIframeEvent): void => {
    if (this.disposed) return;
    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.observer, previous, event, result);
    const execute = () => {
      for (const command of result.commands) {
        try {
          this.runner.execute(this.appId, command, this.send);
        } catch (error) {
          console.error(
            `Preview iframe command execution failed for app ${this.appId}:`,
            error,
          );
        }
      }
    };
    if (result.state !== previous) {
      this.store.setState(result.state, execute);
    } else {
      execute();
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.store.dispose();
  }
}
