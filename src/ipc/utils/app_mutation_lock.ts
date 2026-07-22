import { withLock } from "./lock_utils";

/** Serialize mutations for one app while allowing unrelated apps to proceed. */
export function createAppMutationLock<Event, Input, Output>(
  handler: (event: Event, input: Input) => Promise<Output>,
): (event: Event, input: Input) => Promise<Output> {
  return (event, input) =>
    withLock((input as { appId: number }).appId, () => handler(event, input));
}
