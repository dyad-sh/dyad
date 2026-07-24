import {
  TransactionalDispatcher,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import { stay, type TransitionObserver } from "@/state_machines/types";
import type {
  ImageGenerationCommand,
  ImageGenerationEvent,
  ImageGenerationJobDetails,
  ImageGenerationState,
} from "./state";
import { transition } from "./transition";

export interface ImageGenerationCommandRunner {
  run(
    command: ImageGenerationCommand,
    emit: (event: ImageGenerationEvent) => void,
  ): void | Promise<void>;
  beforeStateCommit?(
    previous: ImageGenerationState,
    next: ImageGenerationState,
  ): void;
  dispose?(): void;
}

type ControllerEvent =
  | ImageGenerationEvent
  | { readonly type: "START"; readonly job: ImageGenerationJobDetails };

export class ImageGenerationController {
  private readonly dispatcher: TransactionalDispatcher<
    ImageGenerationState,
    ControllerEvent,
    ImageGenerationCommand
  >;
  private started = false;
  private disposed = false;

  constructor(
    private readonly runner: ImageGenerationCommandRunner,
    job: ImageGenerationJobDetails,
    private readonly observer?: TransitionObserver<
      ImageGenerationState,
      ImageGenerationEvent,
      ImageGenerationCommand
    >,
    reportError?: (error: DispatcherError<ImageGenerationCommand>) => void,
  ) {
    this.dispatcher = new TransactionalDispatcher({
      initialState: { type: "pending", job } as ImageGenerationState,
      transition(state, event) {
        if (event.type === "START") {
          return stay(state, [
            {
              type: "GenerateImage",
              jobId: event.job.id,
              params: {
                prompt: event.job.prompt,
                themeMode: event.job.themeMode,
                targetAppId: event.job.targetAppId,
                targetAppName: event.job.targetAppName,
                source: event.job.source,
              },
            },
          ]);
        }
        return transition(state, event);
      },
      runCommand: (command, emit) =>
        runner.run(command, emit as (event: ImageGenerationEvent) => void),
      scheduler: {
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      },
      beforeCommit: (previous, next) =>
        runner.beforeStateCommit?.(previous, next),
      observer: observer
        ? {
            onTransitionApplied(args) {
              if (args.event.type === "START") return;
              observer.onTransitionApplied?.({
                ...args,
                event: args.event,
              });
            },
            onEventIgnored(args) {
              if (args.event.type === "START") return;
              observer.onEventIgnored?.({
                ...args,
                event: args.event,
              });
            },
          }
        : undefined,
      reportError,
    });
  }

  getSnapshot = (): ImageGenerationState => this.dispatcher.getSnapshot();

  subscribe = (listener: () => void): (() => void) =>
    this.dispatcher.subscribe(listener);

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const { job } = this.dispatcher.getSnapshot();
    this.dispatcher.send({ type: "START", job });
  }

  send = (event: ImageGenerationEvent): void => {
    this.dispatcher.send(event);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const state = this.dispatcher.getSnapshot();
    this.dispatcher.dispose();
    if (state.type === "pending") {
      this.dispatcher.startFinalizers([
        { type: "RequestCancel", jobId: state.job.id },
      ]);
    }
    this.runner.dispose?.();
  }
}
