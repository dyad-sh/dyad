import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createInvocationRef } from "@/state_machines/invocation_ref";
import type { IdSource } from "@/state_machines/clock";
import type {
  SetupResult,
  SetupStep,
  SetupTarget,
} from "@/ipc/types/coolify_setup";
import {
  COOLIFY_SETUP_INVOCATION_KIND,
  IDLE,
  type CoolifySetupCommand,
  type CoolifySetupEvent,
  type CoolifySetupInvocationRef,
  type CoolifySetupState,
} from "./state";
import { coolifySetupTransition } from "./transition";
import { SnapshotStore } from "@/state_machines/snapshot_store";

const logger = log.scope("coolify_setup_controller");

/**
 * Runs the setup machine and performs what it asks for.
 *
 * The state lives here, in the main process, because the work does. The panel
 * asks for a snapshot and renders it; it keeps nothing of its own, so leaving
 * the screen — which the running screen invites — cannot lose the install.
 *
 * Every launch mints an invocation ref, and every event echoes it back. An
 * answer from a run that was cancelled or superseded is ignored by the
 * transition rather than guarded against here.
 */

export interface SetupRun {
  /** Resolves with what the flow produced, or rejects as the flow did. */
  readonly result: Promise<SetupResult>;
  readonly invocationRef: CoolifySetupInvocationRef;
}

export interface CoolifySetupControllerOptions {
  /** Does the work. Injected so the controller can be tested without SSH. */
  execute: (
    target: SetupTarget,
    hooks: {
      signal: AbortSignal;
      onProgress: (step: SetupStep, output?: string) => void;
    },
  ) => Promise<SetupResult>;
  ids: IdSource;
  /** Told after every applied transition, so windows can be updated. */
  onChanged?: (state: CoolifySetupState) => void;
}

export class CoolifySetupController {
  /**
   * The snapshot everything else reads.
   *
   * The shared store rather than a field and a callback: it already refuses
   * to notify when the reference has not moved, which is the difference
   * between `stay` and `change`, and it can be disposed so a late answer
   * cannot reach windows after teardown.
   */
  private readonly store = new SnapshotStore<CoolifySetupState>(IDLE);
  private aborters = new Map<string, AbortController>();
  private disposed = false;
  private runs = new Map<string, Promise<SetupResult>>();

  constructor(private readonly options: CoolifySetupControllerOptions) {
    if (options.onChanged) {
      this.store.subscribe(() => options.onChanged?.(this.store.getSnapshot()));
    }
  }

  getState(): CoolifySetupState {
    return this.store.getSnapshot();
  }

  /** Stops telling anyone anything. Nothing in flight is cancelled by it. */
  dispose(): void {
    this.disposed = true;
    this.store.dispose();
  }

  /**
   * Starts a setup, or refuses because one is already going.
   *
   * The refusal is the machine's decision rather than a check here, so the
   * rule is tested where it is made.
   */
  start(target: SetupTarget): SetupRun {
    const invocationRef = createInvocationRef(
      COOLIFY_SETUP_INVOCATION_KIND,
      target.host.trim(),
      this.options.ids,
    );
    const before = this.store.getSnapshot();
    this.dispatch({ type: "start-requested", invocationRef, target });
    if (this.store.getSnapshot() === before) {
      // Nothing launched: the machine refused. Named for the user rather than
      // for the log, because this is what the panel shows.
      throw new DyadError(
        "A server is already being set up. Wait for it to finish, or cancel it.",
        DyadErrorKind.Precondition,
      );
    }
    const result = this.runs.get(invocationRef.operationId);
    if (!result) {
      // Unreachable: a launch command is emitted with the state change.
      throw new DyadError(
        "The setup did not start.",
        DyadErrorKind.Precondition,
      );
    }
    return { result, invocationRef };
  }

  /** Asks a running setup to stop. Quiet when there is nothing to stop. */
  cancel(): void {
    this.dispatch({ type: "cancel-requested" });
  }

  /** The user has read the terminal screen; put the panel back to the form. */
  dismiss(): void {
    this.dispatch({ type: "dismissed" });
  }

  private dispatch(event: CoolifySetupEvent): void {
    const result = coolifySetupTransition(this.store.getSnapshot(), event);
    if (result.kind === "ignored") {
      logger.info(`Ignored ${event.type}: ${result.reason}`);
      return;
    }
    // Told first, then the work is started. A command that dispatches again —
    // the flow reports its first step as soon as it is launched — then sends
    // its own notification, so each one says something that changed rather
    // than two saying the same thing.
    //
    // A disposed store keeps nothing and tells nobody, so running the
    // commands anyway would start an install over SSH that no window could
    // see, cancel, or hear the end of — while `start` reported it as running.
    // A transition can ask for something without changing the state — a
    // second cancel re-sends the abort — and setState answers false for that
    // as well as for a disposed store. Only the disposed case is a reason to
    // do nothing.
    this.store.setState(result.state);
    if (this.disposed) return;
    for (const command of result.commands) this.run(command);
  }

  private run(command: CoolifySetupCommand): void {
    switch (command.type) {
      case "launch":
        this.launch(command.invocationRef, command.target);
        return;
      case "abort":
        this.aborters.get(command.invocationRef.operationId)?.abort();
        return;
    }
  }

  private launch(
    invocationRef: CoolifySetupInvocationRef,
    target: SetupTarget,
  ): void {
    const controller = new AbortController();
    this.aborters.set(invocationRef.operationId, controller);

    // Started inside a try, because an executor can throw before it returns a
    // promise — reading the server key does, on a key file it cannot parse.
    // Handlers attached to a promise that was never made never run, which
    // would leave the machine running with nothing running.
    let started: Promise<SetupResult>;
    try {
      started = this.options.execute(target, {
        signal: controller.signal,
        onProgress: (step, output) =>
          this.dispatch({ type: "progress", invocationRef, step, output }),
      });
    } catch (error) {
      started = Promise.reject(error);
    }

    const work = started
      .then((result) => {
        this.dispatch({ type: "succeeded", invocationRef, result });
        return result;
      })
      .catch((error: unknown) => {
        const cancelled =
          (error as { kind?: string }).kind === DyadErrorKind.UserCancelled;
        this.dispatch({
          type: "failed",
          invocationRef,
          message: error instanceof Error ? error.message : String(error),
          cancelled,
          // Set by whatever could not put the server back as it found it.
          warning:
            error instanceof Error
              ? (error as Error & { warning?: string }).warning
              : undefined,
        });
        throw error;
      })
      .finally(() => {
        this.aborters.delete(invocationRef.operationId);
        this.runs.delete(invocationRef.operationId);
      });

    // Kept so a second caller can await the same work rather than starting
    // its own, and so the handler that asked can answer its own invoke.
    this.runs.set(invocationRef.operationId, work);
    // Nothing else attaches to this promise, and an install that fails with
    // no window listening must not take the process down.
    work.catch(() => {});
  }
}
