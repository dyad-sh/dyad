import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createTraceObserver } from "@/state_machines/trace";
import type { TransitionObserver } from "@/state_machines/types";
import {
  type ConflictResolutionRunner,
  GithubOpsCommandRunner,
} from "./commands";
import { GithubOpsController } from "./controller";
import {
  INITIAL_GITHUB_OPS_STATE,
  type GithubOpsCommand,
  type GithubOpsEvent,
  type GithubOpsState,
} from "./state";

export class GithubOpsManager {
  private readonly host: KeyedControllerHost<number, GithubOpsController>;

  constructor(
    private readonly runner: GithubOpsCommandRunner,
    observer?: (
      appId: number,
    ) => TransitionObserver<GithubOpsState, GithubOpsEvent, GithubOpsCommand>,
  ) {
    this.host = new KeyedControllerHost(
      (appId) =>
        new GithubOpsController(
          appId,
          runner,
          observer?.(appId) ?? createTraceObserver("github_ops", appId),
        ),
    );
  }

  getSnapshot = (appId: number): GithubOpsState =>
    this.host.get(appId)?.getSnapshot() ?? INITIAL_GITHUB_OPS_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  send(appId: number, event: GithubOpsEvent): void {
    this.host.ensure(appId).send(event);
  }

  registerConflictResolutionRunner(
    appId: number,
    conflictRunner: ConflictResolutionRunner,
  ): () => void {
    return this.runner.registerConflictResolutionRunner(appId, conflictRunner);
  }

  disposeKey = (appId: number): void => {
    this.host.disposeKey(appId);
  };

  dispose(): void {
    this.host.dispose();
  }
}
