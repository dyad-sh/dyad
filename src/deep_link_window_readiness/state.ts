/**
 * Window readiness is identity-based and synchronous. A target may be
 * superseded by focus or window creation at any time; readiness events for
 * non-target windows are retained so returning focus can deliver immediately.
 * Commands serialize the current target's readiness into the owning queue.
 */

export type WindowReadinessKey = number;

export interface DeepLinkWindowReadinessState {
  readonly target: WindowReadinessKey | null;
  readonly readyWindows: readonly WindowReadinessKey[];
}

export type DeepLinkWindowReadinessEvent =
  | { type: "TARGET_CHANGED"; target: WindowReadinessKey | null }
  | { type: "WINDOW_READY"; window: WindowReadinessKey }
  | { type: "WINDOW_NOT_READY"; window: WindowReadinessKey };

export type DeepLinkWindowReadinessCommand =
  | { type: "MarkQueueReady" }
  | { type: "MarkQueueNotReady" };

export type DeepLinkWindowReadinessIgnoreReason =
  | "target-unchanged"
  | "window-already-ready"
  | "window-already-not-ready";

export type DeepLinkWindowReadinessTransitionResult =
  import("@/state_machines/types").TransitionResult<
    DeepLinkWindowReadinessState,
    DeepLinkWindowReadinessCommand,
    DeepLinkWindowReadinessIgnoreReason
  >;
