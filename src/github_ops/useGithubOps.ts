import { useCallback, useEffect } from "react";
import { useKeyedController } from "@/state_machines/react";
import type { ConflictResolutionRunner } from "./commands";
import { useGithubOpsManager } from "./GithubOpsProvider";
import { projectGithubOps } from "./projection";
import type { GithubOpsEvent } from "./state";

const NO_APP_ID = -1;

export function useGithubOps(
  appId: number | null,
  options: {
    conflictResolutionRunner?: ConflictResolutionRunner;
    reconcileOnMount?: boolean;
  } = {},
) {
  const manager = useGithubOpsManager();
  const state = useKeyedController(manager, appId ?? NO_APP_ID);
  const send = useCallback(
    (event: GithubOpsEvent) => {
      if (appId !== null) manager.send(appId, event);
    },
    [appId, manager],
  );

  useEffect(() => {
    if (appId === null || !options.conflictResolutionRunner) return;
    return manager.registerConflictResolutionRunner(
      appId,
      options.conflictResolutionRunner,
    );
  }, [appId, manager, options.conflictResolutionRunner]);

  const reconcileOnMount = options.reconcileOnMount ?? true;
  useEffect(() => {
    if (appId === null || !reconcileOnMount) return;
    const reconcile = () => send({ type: "RECONCILE_REQUESTED" });
    reconcile();
    window.addEventListener("focus", reconcile);
    return () => window.removeEventListener("focus", reconcile);
  }, [appId, reconcileOnMount, send]);

  return {
    state,
    projection: projectGithubOps(state),
    send,
  };
}

export function useRegisterGithubConflictResolution(
  appId: number | null,
  runner: ConflictResolutionRunner,
): void {
  const manager = useGithubOpsManager();
  useEffect(() => {
    if (appId === null) return;
    return manager.registerConflictResolutionRunner(appId, runner);
  }, [appId, manager, runner]);
}
