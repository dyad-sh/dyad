import type { CoolifyDeployState } from "./state";

export interface CoolifyDeployCapabilities {
  readonly canDeploy: boolean;
  /**
   * Saving a connection is a database write rather than a machine event, so
   * unlike `canDeploy` this one has no transition to stay consistent with.
   * Retargeting mid-deploy would land the result on a server the app is no
   * longer connected to.
   */
  readonly canEditConnection: boolean;
}

/** Pure domain policy for the interactive controls on the Coolify panel. */
export function selectCoolifyDeployCapabilities(
  state: CoolifyDeployState,
): CoolifyDeployCapabilities {
  const isRunning = state.type === "running";
  return {
    canDeploy: !isRunning,
    canEditConnection: !isRunning,
  };
}
