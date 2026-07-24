import {
  TransactionalDispatcher,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import type { TransitionObserver } from "@/state_machines/types";
import type { IdSource } from "@/state_machines/clock";
import type {
  VoiceCommand,
  VoiceEvent,
  VoiceState,
  VoiceStopReason,
} from "./state";
import { transition } from "./transition";

export interface VoiceCommandRunner {
  run(
    command: VoiceCommand,
    emit: (event: VoiceEvent) => void,
  ): void | Promise<void>;
  beforeStateCommit?(previous: VoiceState, next: VoiceState): void;
  dispose?(): void;
}

export interface VoiceToTextControllerOptions {
  idSource: IdSource;
  runner: VoiceCommandRunner;
  observer?: TransitionObserver<VoiceState, VoiceEvent, VoiceCommand>;
  reportError?(error: DispatcherError<VoiceCommand>): void;
}

/**
 * One controller is owned by one useVoiceToText mount. Voice recording is
 * deliberately input-scoped rather than keyed globally: the home and chat
 * inputs live on mutually exclusive routes, and unmounting an input ends its
 * capture. Commands may complete concurrently; attempt IDs reject late work.
 */
export class VoiceToTextController {
  private readonly dispatcher: TransactionalDispatcher<
    VoiceState,
    VoiceEvent,
    VoiceCommand
  >;
  private disposed = false;

  constructor(private readonly options: VoiceToTextControllerOptions) {
    this.dispatcher = new TransactionalDispatcher({
      initialState: { type: "idle" },
      transition,
      runCommand: (command, emit) => options.runner.run(command, emit),
      scheduler: {
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      },
      beforeCommit: (previous, next) =>
        options.runner.beforeStateCommit?.(previous, next),
      observer: options.observer,
      reportError: options.reportError,
    });
  }

  getSnapshot = (): VoiceState => this.dispatcher.getSnapshot();

  subscribe = (listener: () => void): (() => void) =>
    this.dispatcher.subscribe(listener);

  toggle = (): void => {
    this.dispatcher.send({
      type: "TOGGLE",
      attempt: this.options.idSource.next("voice-attempt"),
    });
  };

  send = (event: VoiceEvent): void => this.dispatcher.send(event);

  /** Stop browser resources and permanently discard all late completions. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const state = this.dispatcher.getSnapshot();
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
      this.dispatcher.startFinalizers(commands);
    }
    this.dispatcher.dispose();
    this.options.runner.dispose?.();
  }
}

export function isVoiceRecording(state: VoiceState): boolean {
  return state.type === "recording" || state.type === "stopping";
}

export function isVoiceTranscribing(state: VoiceState): boolean {
  return state.type === "transcribing";
}

export type { VoiceStopReason };
