import type { ChatStreamRemoteSnapshot } from "./transport";

/** True while the main-owned stream is active from the user's point of view. */
export function isStreamActive(
  state: Pick<ChatStreamRemoteSnapshot, "phase"> | { readonly type: string },
): boolean {
  if ("phase" in state) {
    return (
      state.phase === "admitting" ||
      state.phase === "streaming" ||
      state.phase === "cancelling" ||
      state.phase === "finalizing"
    );
  }
  return (
    state.type === "starting" ||
    state.type === "streaming" ||
    state.type === "cancelling"
  );
}

export function selectStreamError(
  state:
    | Pick<ChatStreamRemoteSnapshot, "error">
    | { readonly type: string; readonly error?: string },
): string | null {
  if ("type" in state) {
    return state.type === "errored" ? (state.error ?? null) : null;
  }
  return state.error;
}

export function streamInvocationRef(
  state:
    | Pick<ChatStreamRemoteSnapshot, "invocationRef">
    | { readonly type: string },
): ChatStreamRemoteSnapshot["invocationRef"] | undefined {
  return "invocationRef" in state
    ? (state.invocationRef ?? undefined)
    : undefined;
}
