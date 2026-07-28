import { TransactionalDispatcher } from "@/state_machines/dispatcher";
import {
  runDeepLinkWindowReadinessCommand,
  type ReadinessQueue,
} from "./commands";
import type {
  DeepLinkWindowReadinessCommand,
  DeepLinkWindowReadinessEvent,
  DeepLinkWindowReadinessState,
} from "./state";
import { transition } from "./transition";

export class DeepLinkWindowReadiness<TWindow extends object> {
  private readonly dispatcher: TransactionalDispatcher<
    DeepLinkWindowReadinessState,
    DeepLinkWindowReadinessEvent,
    DeepLinkWindowReadinessCommand
  >;
  private readonly windowKeys = new WeakMap<TWindow, number>();
  private nextWindowKey = 1;
  private target: TWindow | null = null;

  constructor(queue: ReadinessQueue) {
    this.dispatcher = new TransactionalDispatcher({
      initialState: { target: null, readyWindows: [] },
      transition,
      runCommand: (command) =>
        runDeepLinkWindowReadinessCommand(queue, command),
      scheduler: {
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      },
    });
  }

  getTarget(): TWindow | null {
    return this.target;
  }

  setTarget(target: TWindow | null): void {
    this.target = target;
    this.dispatcher.send({
      type: "TARGET_CHANGED",
      target: target ? this.keyFor(target) : null,
    });
  }

  markReady(window: TWindow): void {
    this.dispatcher.send({ type: "WINDOW_READY", window: this.keyFor(window) });
  }

  markNotReady(window: TWindow): void {
    this.dispatcher.send({
      type: "WINDOW_NOT_READY",
      window: this.keyFor(window),
    });
  }

  private keyFor(window: TWindow): number {
    const existing = this.windowKeys.get(window);
    if (existing !== undefined) return existing;
    const key = this.nextWindowKey++;
    this.windowKeys.set(window, key);
    return key;
  }
}
