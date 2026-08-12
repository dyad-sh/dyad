import {
  appOperationCoordinator,
  type AppOperationRequest,
} from "../services/app_operation_coordinator";

/**
 * Wrap an IPC handler in the declared app-resource operation.
 *
 * `refuseWhenRecording` names the action, in the imperative, for handlers that
 * would otherwise queue invisibly behind a recording session's claims.
 */
export function createAppOperationHandler<Event, Input, Output>(
  operation: string,
  resources: AppOperationRequest["resources"],
  handler: (event: Event, input: Input) => Promise<Output>,
  refuseWhenRecording?: string,
): (event: Event, input: Input) => Promise<Output> {
  return (event, input) =>
    appOperationCoordinator.run(
      {
        appId: (input as { appId: number }).appId,
        operation,
        resources,
        refuseWhenRecording,
      },
      () => handler(event, input),
    );
}
