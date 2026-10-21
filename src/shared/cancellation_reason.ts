/**
 * Why in-flight work was cancelled, carried as an `AbortSignal` reason.
 *
 * A reason passed to `controller.abort(reason)` survives `AbortSignal.any()`
 * composition, so nested work — a test run started by an agent tool, inside a
 * Claude Code tool call, inside a chat turn — can report the cause that
 * actually reached it instead of a bare "stopped".
 *
 * The reason is an `AbortError` DOMException, so existing abort handling
 * (`error.name === "AbortError"`, the AI SDK's abort detection, and
 * `reject(signal.reason)`) treats it exactly like a reasonless abort.
 */
export const CANCELLATION_CAUSES = [
  "tests-panel-stop",
  "chat-stop",
  "chat-deleted",
  "version-restored",
  "subagent-stopped",
  "pro-revoked",
  "claude-code-call-abandoned",
  "claude-code-session-ended",
  "agent-cancelled",
  "app-deleted",
  "app-quit",
] as const;

export type CancellationCause = (typeof CANCELLATION_CAUSES)[number];

/** Plain-data form of a cancellation, safe to store in state and send over IPC. */
export interface CancellationInfo {
  readonly kind: CancellationCause;
  /** Free-form detail from the canceller, e.g. Claude Code's MCP reason. */
  readonly detail?: string;
}

const DESCRIPTIONS: Record<CancellationCause, string> = {
  "tests-panel-stop": "Stopped from the Tests panel",
  "chat-stop": "The chat response was stopped",
  "chat-deleted": "The chat was deleted",
  "version-restored": "An earlier version of the app was restored",
  "subagent-stopped": "The sub-agent was stopped",
  "pro-revoked": "Dyad Pro is no longer active",
  "claude-code-call-abandoned":
    "Claude Code stopped waiting for this tool call",
  "claude-code-session-ended": "The Claude Code session ended",
  "agent-cancelled": "The agent turn was cancelled",
  "app-deleted": "The app is being deleted",
  "app-quit": "Dyad is quitting",
};

export class CancellationReason extends DOMException {
  readonly kind: CancellationCause;
  readonly detail?: string;

  constructor(kind: CancellationCause, detail?: string) {
    super(
      detail ? `${DESCRIPTIONS[kind]}: ${detail}` : `${DESCRIPTIONS[kind]}.`,
      "AbortError",
    );
    this.kind = kind;
    if (detail) this.detail = detail;
  }

  toInfo(): CancellationInfo {
    return this.detail
      ? { kind: this.kind, detail: this.detail }
      : { kind: this.kind };
  }
}

/** The cancellation carried by an abort reason, if a canceller recorded one. */
export function getCancellationInfo(
  reason: unknown,
): CancellationInfo | undefined {
  return reason instanceof CancellationReason ? reason.toInfo() : undefined;
}
