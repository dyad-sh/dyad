import {
  TransactionalDispatcher,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import type { TransitionObserver } from "@/state_machines/types";
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

export class ScreenshotController {
  private readonly dispatcher: TransactionalDispatcher<
    ScreenshotState,
    ScreenshotEvent,
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
      ScreenshotEvent,
      ScreenshotCommand,
      ScreenshotIgnoreReason
    >({
      initialState: INITIAL_SCREENSHOT_STATE,
      transition,
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
      observer,
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
