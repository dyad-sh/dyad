import type { PreviewState } from "./state";

export interface VersionPreviewCapabilities {
  readonly canRestore: boolean;
  readonly canSelectVersion: boolean;
  readonly canSwitchBranch: boolean;
}

export interface VersionPreviewProjection {
  readonly state: PreviewState;
  readonly capabilities: VersionPreviewCapabilities;
}

const projectionCache = new WeakMap<PreviewState, VersionPreviewProjection>();

/** Pure domain policy for interactive controls backed by version events. */
export function selectVersionPreviewCapabilities(
  state: PreviewState,
): VersionPreviewCapabilities {
  switch (state.type) {
    case "viewing-diff":
    case "browsing":
    case "previewing":
      return {
        canRestore: true,
        canSelectVersion: true,
        canSwitchBranch: true,
      };
    case "closed":
      return {
        canRestore: true,
        canSelectVersion: false,
        canSwitchBranch: true,
      };
    case "resolving-origin":
      return {
        canRestore: false,
        canSelectVersion: true,
        canSwitchBranch: false,
      };
    case "recovery-required":
      return {
        canRestore: false,
        canSelectVersion: false,
        canSwitchBranch: true,
      };
    case "checking-out":
    case "restoring":
    case "returning":
    case "switching-branch":
      return {
        canRestore: false,
        canSelectVersion: false,
        canSwitchBranch: false,
      };
  }
}

/** Reference-stable view consumed by version-preview UI. */
export function projectVersionPreview(
  state: PreviewState,
): VersionPreviewProjection {
  const cached = projectionCache.get(state);
  if (cached) return cached;
  const projection = {
    state,
    capabilities: selectVersionPreviewCapabilities(state),
  };
  projectionCache.set(state, projection);
  return projection;
}
