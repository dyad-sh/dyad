import type { CoolifySetupState } from "./state";

export interface CoolifySetupCapabilities {
  /**
   * Whether an install may be started.
   *
   * False while one is going, because the machine refuses a second one —
   * offering the button anyway means the answer to pressing it is an error
   * message rather than an install.
   */
  readonly canStart: boolean;
  /** Whether there is something to stop. */
  readonly canCancel: boolean;
}

/**
 * Pure domain policy for the controls on the setup panel.
 *
 * Only what the state decides. Whether the address looks like an address, or
 * whether the key could be read, are questions about the form in front of the
 * user and stay with it — this answers the questions the machine owns, and
 * answers them the same way the transition does.
 */
export function selectCoolifySetupCapabilities(
  state: CoolifySetupState,
): CoolifySetupCapabilities {
  const isRunning = state.type === "running";
  return {
    canStart: !isRunning,
    canCancel: isRunning && !state.stopping,
  };
}
