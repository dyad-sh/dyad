import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import type { IdSource } from "@/state_machines/clock";
import type {
  VoiceCommand,
  VoiceEvent,
  VoiceState,
  VoiceStopReason,
} from "./state";
import { transition } from "./transition";

export interface VoiceCommandRunner {
  run(command: VoiceCommand, emit: (event: VoiceEvent) => void): void;
}

export interface VoiceToTextControllerOptions {
  idSource: IdSource;
  runner: VoiceCommandRunner;
  observer?: TransitionObserver<VoiceState, VoiceEvent, VoiceCommand>;
}

/**
 * One controller is owned by one useVoiceToText mount. Voice recording is
 * deliberately input-scoped rather than keyed globally: the home and chat
 * inputs live on mutually exclusive routes, and unmounting an input ends its
 * capture. Commands may complete concurrently; attempt IDs reject late work.
 */
export class VoiceToTextController {
  private readonly store = new SnapshotStore<VoiceState>({ type: "idle" });
  private readonly pendingEvents: VoiceEvent[] = [];
  private processing = false;
  private disposed = false;

  constructor(private readonly options: VoiceToTextControllerOptions) {}

  getSnapshot = this.store.getSnapshot;

  subscribe = this.store.subscribe;

  toggle = (): void => {
    this.send({
      type: "TOGGLE",
      attempt: this.options.idSource.next("voice-attempt"),
    });
  };

  send = (event: VoiceEvent): void => {
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
        this.processOne(next);
      }
    } finally {
      this.processing = false;
    }
  };

  private processOne(event: VoiceEvent): void {
    if (this.disposed) return;
    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.options.observer, previous, event, result);
    if (result.state !== previous) this.store.setState(result.state);
    for (const command of result.commands) {
      try {
        this.options.runner.run(command, this.send);
      } catch (error) {
        console.error("Voice-to-text command execution failed:", error);
      }
    }
  }

  /** Stop browser resources and permanently discard all late completions. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingEvents.length = 0;
    const state = this.store.getSnapshot();
    if (state.type !== "idle") {
      const commands: VoiceCommand[] = [
        { type: "CancelDurationLimit", attempt: state.attempt },
        {
          type: "StopRecorder",
          attempt: state.attempt,
          reason: null,
        },
        { type: "ReleaseMedia", attempt: state.attempt },
      ];
      for (const command of commands) {
        try {
          this.options.runner.run(command, () => undefined);
        } catch (error) {
          console.error("Voice-to-text disposal command failed:", error);
        }
      }
    }
    this.store.dispose();
  }
}

export function isVoiceRecording(state: VoiceState): boolean {
  return state.type === "recording" || state.type === "stopping";
}

export function isVoiceTranscribing(state: VoiceState): boolean {
  return state.type === "transcribing";
}

export type { VoiceStopReason };
