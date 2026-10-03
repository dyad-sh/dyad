import {
  appOperationCoordinator,
  type AppOperationContext,
  type AppOperationRequest,
} from "./app_operation_coordinator";

/**
 * Coordinates work for a turn that may run in an isolated workspace.
 *
 * A worktree isolates files, the index, and HEAD, so claims on those
 * (`repository`, `repository-worktree`, `runtime`) are taken on the
 * workspace's own coordination key and no longer queue behind work in the
 * app's original directory. App-wide resources (providers, media, runtime
 * configuration, app path) keep their existing app-keyed claims.
 *
 * Workspace keys are always larger than app ids, so acquiring the app claims
 * first and the workspace claims second follows the coordinator's required
 * ascending-id order for cross-key operations.
 */
export interface WorkspaceScopedOperationRequest {
  appId: number;
  /**
   * Coordination key of the turn's isolated workspace
   * (`workspaceRuntimeId(workspaceId)`), or undefined when the turn works in
   * the app's original directory.
   */
  workspaceKey?: number;
  operation: string;
  /** Claims on app-wide state shared by every workspace. */
  appResources: AppOperationRequest["resources"];
  /** Claims on the files, index, and runtime the turn works in. */
  workspaceResources: AppOperationRequest["resources"];
  signal?: AbortSignal;
  /**
   * Refuses instead of queueing while a recording session holds the app.
   * Workspace-only work never touches what a recording holds, so this only
   * applies when the operation claims app resources or runs in the original.
   */
  refuseWhenRecording?: string;
}

/**
 * `blockConflictingOperations` for a workspace-scoped request: fences the
 * app-wide claims on the app and the file/runtime claims on the workspace.
 */
export function blockConflictingWorkspaceScopedOperations(
  request: WorkspaceScopedOperationRequest,
  reason: string,
): () => void {
  const { appId, workspaceKey, operation, appResources, workspaceResources } =
    request;
  if (workspaceKey === undefined) {
    return appOperationCoordinator.blockConflictingOperations(
      {
        appId,
        operation,
        resources: [...appResources, ...workspaceResources],
      },
      reason,
    );
  }
  const releases = [
    appOperationCoordinator.blockConflictingOperations(
      { appId: workspaceKey, operation, resources: workspaceResources },
      reason,
    ),
    ...(appResources.length > 0
      ? [
          appOperationCoordinator.blockConflictingOperations(
            { appId, operation, resources: appResources },
            reason,
          ),
        ]
      : []),
  ];
  return () => {
    for (const release of releases) release();
  };
}

export function runWorkspaceScopedOperation<Result>(
  request: WorkspaceScopedOperationRequest,
  operation: (context: AppOperationContext) => Promise<Result>,
): Promise<Result> {
  const {
    appId,
    workspaceKey,
    operation: name,
    appResources,
    workspaceResources,
    signal,
    refuseWhenRecording,
  } = request;
  if (workspaceKey === undefined) {
    return appOperationCoordinator.run(
      {
        appId,
        operation: name,
        resources: [...appResources, ...workspaceResources],
        signal,
        refuseWhenRecording,
      },
      operation,
    );
  }
  const runInWorkspace = () =>
    appOperationCoordinator.run(
      {
        appId: workspaceKey,
        operation: name,
        resources: workspaceResources,
        signal,
      },
      operation,
    );
  if (appResources.length === 0) return runInWorkspace();
  return appOperationCoordinator.run(
    {
      appId,
      operation: name,
      resources: appResources,
      signal,
      refuseWhenRecording,
    },
    runInWorkspace,
  );
}
