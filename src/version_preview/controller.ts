/**
 * Executes the commands returned by transition() and feeds completion events
 * back into the machine. This is the only place operation identity exists:
 * a private epoch counter for the single read command (origin resolution).
 * Mutation completions are never dropped.
 *
 * The controller never touches React, the DOM, or UI atoms. Its outputs are
 * immutable state snapshots (for useSyncExternalStore) and command
 * executions through the injected runtime.
 */

import type {
  PreviewCommand,
  PreviewError,
  PreviewEvent,
  PreviewState,
} from "./state";
import { CLOSED_STATE } from "./state";
import { transition } from "./transition";
import { recordVersionPreviewTransition } from "./debug";

export interface VersionPreviewCommands {
  /**
   * Resolves the branch to return to after previewing. Returns null when the
   * branch is unavailable (e.g. detached HEAD); throws on lookup failure.
   */
  resolveOriginBranch(input: { appId: number }): Promise<{
    branch: string | null;
  }>;
  checkoutVersion(input: {
    appId: number;
    versionId: string;
    hasDbSnapshot: boolean;
  }): Promise<void>;
  returnToBranch(input: { appId: number; branch: string }): Promise<void>;
  restoreVersion(input: {
    appId: number;
    versionId: string;
    targetBranch: string;
    hasDbSnapshot: boolean;
  }): Promise<void>;
}

export interface VersionPreviewRuntime {
  commands: VersionPreviewCommands;
  notifyError(message: string): void;
}

function toPreviewError(error: unknown): PreviewError {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

export class VersionPreviewController {
  private state: PreviewState = CLOSED_STATE;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  /** Bumped per resolve dispatch; stale resolve completions are dropped. */
  private resolveEpoch = 0;
  /** Defense in depth: the state graph already serializes mutations. */
  private mutationInFlight = false;

  constructor(
    readonly appId: number,
    private readonly runtime: VersionPreviewRuntime,
  ) {}

  getSnapshot = (): PreviewState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  send = (event: PreviewEvent): void => {
    if (this.disposed) {
      return;
    }
    const previous = this.state;
    const result = transition(previous, event);
    recordVersionPreviewTransition({
      appId: this.appId,
      from: previous,
      event,
      to: result.state,
      commands: result.commands,
    });
    this.state = result.state;
    for (const command of result.commands) {
      this.execute(command);
    }
    if (result.state !== previous) {
      for (const listener of this.listeners) {
        listener();
      }
    }
  };

  /** Permanently detaches this controller from late async completions. */
  dispose(): void {
    this.disposed = true;
    this.resolveEpoch += 1;
    this.listeners.clear();
  }

  private execute(command: PreviewCommand): void {
    switch (command.type) {
      case "resolve-origin": {
        const epoch = ++this.resolveEpoch;
        void this.runtime.commands
          .resolveOriginBranch({ appId: command.appId })
          .then(
            ({ branch }) => {
              if (epoch !== this.resolveEpoch) {
                return;
              }
              if (branch === null) {
                this.send({ type: "ORIGIN_RESOLUTION_FAILED" });
              } else {
                this.send({ type: "ORIGIN_RESOLVED", branch });
              }
            },
            () => {
              if (epoch !== this.resolveEpoch) {
                return;
              }
              this.send({ type: "ORIGIN_RESOLUTION_FAILED" });
            },
          );
        return;
      }
      case "checkout": {
        this.runMutation(
          this.runtime.commands.checkoutVersion({
            appId: command.appId,
            versionId: command.versionId,
            hasDbSnapshot: command.hasDbSnapshot,
          }),
          { type: "CHECKOUT_SUCCEEDED" },
          (error) => ({ type: "CHECKOUT_FAILED", error }),
        );
        return;
      }
      case "return": {
        this.runMutation(
          this.runtime.commands.returnToBranch({
            appId: command.appId,
            branch: command.branch,
          }),
          { type: "RETURN_SUCCEEDED" },
          (error) => ({ type: "RETURN_FAILED", error }),
        );
        return;
      }
      case "restore": {
        this.runMutation(
          this.runtime.commands.restoreVersion({
            appId: command.appId,
            versionId: command.versionId,
            targetBranch: command.targetBranch,
            hasDbSnapshot: command.hasDbSnapshot,
          }),
          { type: "RESTORE_SUCCEEDED" },
          (error) => ({ type: "RESTORE_FAILED", error }),
        );
        return;
      }
      case "notify-error": {
        this.runtime.notifyError(command.message);
        return;
      }
    }
  }

  private runMutation(
    operation: Promise<void>,
    successEvent: PreviewEvent,
    failureEvent: (error: PreviewError) => PreviewEvent,
  ): void {
    if (this.mutationInFlight) {
      // The transition matrix makes this unreachable; if it ever fires the
      // machine and controller have diverged and must be fixed.
      const message =
        "version_preview: attempted to start a Git mutation while another is in flight";
      if (process.env.NODE_ENV !== "production") {
        throw new Error(message);
      }
      console.error(message);
    }
    this.mutationInFlight = true;
    void operation.then(
      () => {
        this.mutationInFlight = false;
        this.send(successEvent);
      },
      (error) => {
        this.mutationInFlight = false;
        this.send(failureEvent(toPreviewError(error)));
      },
    );
  }
}
