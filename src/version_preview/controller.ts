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
import { createVersionPreviewTransitionObserver } from "./debug";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";

export interface VersionPreviewCommands {
  /**
   * Resolves the branch to return to after previewing. Returns null when the
   * branch is unavailable (e.g. detached HEAD); throws on lookup failure.
   */
  resolveOriginBranch(input: { appId: number }): Promise<{
    branch: string | null;
  }>;
  checkoutVersion(input: { appId: number; versionId: string }): Promise<void>;
  returnToBranch(input: { appId: number; branch: string }): Promise<void>;
  switchBranch(input: { appId: number; branch: string }): Promise<void>;
  restoreVersion(input: {
    appId: number;
    versionId: string;
    targetBranch: string | null;
    currentChatMessageId?: { chatId: number; messageId: number };
  }): Promise<void>;
  restoreToMessage(input: {
    appId: number;
    chatId: number;
    messageId: number;
    restoreCodebase: boolean;
    targetBranch: string | null;
  }): Promise<{ repositoryOutcome: "target-applied" | "unchanged" }>;
}

export interface VersionPreviewRuntime {
  commands: VersionPreviewCommands;
  notifyError(message: string): void;
  notifyRecovery(input: {
    appId: number;
    error: PreviewError;
    retry: () => void;
  }): void;
  dismissRecovery(appId: number): void;
}

function toPreviewError(error: unknown): PreviewError {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

export class VersionPreviewController {
  private readonly store = new SnapshotStore<PreviewState>(CLOSED_STATE);
  private disposed = false;
  /** Bumped per resolve dispatch; stale resolve completions are dropped. */
  private resolveEpoch = 0;
  /** Defense in depth: the state graph already serializes mutations. */
  private mutationInFlight = false;
  private mutationWaiter: {
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;

  constructor(
    readonly appId: number,
    private readonly runtime: VersionPreviewRuntime,
    private readonly observer: TransitionObserver<
      PreviewState,
      PreviewEvent,
      PreviewCommand
    > = createVersionPreviewTransitionObserver(appId),
  ) {}

  getSnapshot = this.store.getSnapshot;

  subscribe = this.store.subscribe;

  send = (event: PreviewEvent): void => {
    this.dispatch(event);
  };

  private dispatch(event: PreviewEvent): boolean {
    if (this.disposed) {
      return false;
    }
    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.observer, previous, event, result);
    if (result.state !== previous) {
      this.store.setState(result.state, () => {
        for (const command of result.commands) this.execute(command);
      });
    } else {
      for (const command of result.commands) this.execute(command);
    }
    return result.commands.some((command) =>
      [
        "checkout",
        "return",
        "switch-branch",
        "restore",
        "restore-to-message",
      ].includes(command.type),
    );
  }

  sendAndWaitForMutation(event: PreviewEvent): Promise<void> {
    if (this.mutationInFlight || this.mutationWaiter) {
      return Promise.reject(new Error("A version mutation is already pending"));
    }
    return new Promise<void>((resolve, reject) => {
      this.mutationWaiter = { resolve, reject };
      const startedMutation = this.dispatch(event);
      if (!startedMutation) {
        this.mutationWaiter = null;
        reject(new Error("The version mutation was not accepted"));
      }
    });
  }

  /** Permanently detaches this controller from late async completions. */
  dispose(): void {
    this.disposed = true;
    this.resolveEpoch += 1;
    this.store.dispose();
    this.mutationWaiter?.reject(new Error("Version preview was disposed"));
    this.mutationWaiter = null;
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
      case "switch-branch": {
        this.runMutation(
          this.runtime.commands.switchBranch({
            appId: command.appId,
            branch: command.branch,
          }),
          { type: "SWITCH_BRANCH_SUCCEEDED" },
          (error) => ({ type: "SWITCH_BRANCH_FAILED", error }),
        );
        return;
      }
      case "restore": {
        this.runMutation(
          this.runtime.commands.restoreVersion({
            appId: command.appId,
            versionId: command.versionId,
            targetBranch: command.targetBranch,
            currentChatMessageId: command.currentChatMessageId,
          }),
          {
            type: "RESTORE_SUCCEEDED",
            repositoryOutcome: "target-applied",
          },
          (error) => ({ type: "RESTORE_FAILED", error }),
        );
        return;
      }
      case "restore-to-message": {
        this.runMutation(
          this.runtime.commands.restoreToMessage({
            appId: command.appId,
            chatId: command.chatId,
            messageId: command.messageId,
            restoreCodebase: command.restoreCodebase,
            targetBranch: command.targetBranch,
          }),
          (result) => ({
            type: "RESTORE_SUCCEEDED",
            repositoryOutcome: result.repositoryOutcome,
          }),
          (error) => ({ type: "RESTORE_FAILED", error }),
        );
        return;
      }
      case "notify-error": {
        this.runtime.notifyError(command.message);
        return;
      }
      case "notify-recovery": {
        this.runtime.notifyRecovery({
          appId: command.appId,
          error: command.error,
          retry: () => this.send({ type: "RETRY_RETURN" }),
        });
        return;
      }
      case "dismiss-recovery": {
        this.runtime.dismissRecovery(command.appId);
        return;
      }
    }
  }

  private runMutation<T>(
    operation: Promise<T>,
    successEvent: PreviewEvent | ((result: T) => PreviewEvent),
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
      (result) => {
        this.mutationInFlight = false;
        this.send(
          typeof successEvent === "function"
            ? successEvent(result)
            : successEvent,
        );
        if (!this.mutationInFlight) {
          this.mutationWaiter?.resolve();
          this.mutationWaiter = null;
        }
      },
      (error) => {
        this.mutationInFlight = false;
        this.send(failureEvent(toPreviewError(error)));
        this.mutationWaiter?.reject(error);
        this.mutationWaiter = null;
      },
    );
  }
}
