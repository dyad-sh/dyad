import {
  TransactionalDispatcher,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import { stay, type TransitionObserver } from "@/state_machines/types";
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
  ): void | Promise<void>;
  beforeStateCommit?(
    appId: number,
    previous: ScreenshotState,
    next: ScreenshotState,
  ): void;
  disposeKey(appId: number): void;
}

type ControllerEvent =
  | ScreenshotEvent
  | {
      readonly type: "RUN_CONFORMANCE_COMMAND";
      readonly command: ScreenshotCommand;
    };

export class ScreenshotController {
  private readonly dispatcher: TransactionalDispatcher<
    ScreenshotState,
    ControllerEvent,
    ScreenshotCommand,
    ScreenshotIgnoreReason
  >;
  private disposed = false;
  private nextSettleToken = 1;

  constructor(
    readonly appId: number,
    private readonly runner: ScreenshotCommandRunner,
    private readonly observer?: TransitionObserver<
      ScreenshotState,
      ScreenshotEvent,
      ScreenshotCommand,
      ScreenshotIgnoreReason
    >,
    reportError?: (error: DispatcherError<ScreenshotCommand>) => void,
  ) {
    this.dispatcher = new TransactionalDispatcher<
      ScreenshotState,
      ControllerEvent,
      ScreenshotCommand,
      ScreenshotIgnoreReason
    >({
      initialState: INITIAL_SCREENSHOT_STATE,
      transition(state, event) {
        if (event.type === "RUN_CONFORMANCE_COMMAND") {
          return stay(state, [event.command]);
        }
        return transition(state, event);
      },
      runCommand: (command, emit) =>
        runner.execute(this.appId, command, (event) =>
          emit(this.withSettleToken(event)),
        ),
      scheduler: {
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      },
      beforeCommit: (previous, next) =>
        runner.beforeStateCommit?.(this.appId, previous, next),
      observer: observer
        ? {
            onTransitionApplied(args) {
              if (args.event.type === "RUN_CONFORMANCE_COMMAND") return;
              observer.onTransitionApplied?.({
                ...args,
                event: args.event,
              });
            },
            onEventIgnored(args) {
              if (args.event.type === "RUN_CONFORMANCE_COMMAND") return;
              observer.onEventIgnored?.({
                ...args,
                event: args.event,
              });
            },
          }
        : undefined,
      mapUnexpectedCommandError: () =>
        this.withSettleToken({ type: "SAVE_FAILED" }),
      reportError,
    });
  }

  getSnapshot = (): ScreenshotState => this.dispatcher.getSnapshot();
  subscribe = (listener: () => void): (() => void) =>
    this.dispatcher.subscribe(listener);

  send = (event: ScreenshotEvent): void => {
    this.dispatcher.send(this.withSettleToken(event));
  };

  /** @internal Used only by the shared controller conformance adapter. */
  runConformanceCommand(command: ScreenshotCommand): void {
    this.dispatcher.send({ type: "RUN_CONFORMANCE_COMMAND", command });
  }

  private withSettleToken(event: ScreenshotEvent): ScreenshotEvent {
    const settleToken =
      event.settleToken ??
      (event.type === "SETTLE_ELAPSED"
        ? undefined
        : `screenshot-settle:${this.appId}:${this.nextSettleToken++}`);
    return { ...event, settleToken };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dispatcher.dispose();
    this.runner.disposeKey(this.appId);
  }
}
