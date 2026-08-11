import { cn } from "@/lib/utils";
import type { JarvisState } from "@/shared/jarvis/state_machine";

const STATE_LABELS: Record<JarvisState, string> = {
  offline: "Offline",
  connecting: "Connecting",
  idle: "Ready",
  listening: "Listening",
  userSpeaking: "Listening",
  transcribing: "Transcribing",
  thinking: "Thinking",
  executingTool: "Working",
  awaitingConfirmation: "Awaiting confirmation",
  speaking: "Speaking",
  interrupted: "Interrupted",
  disconnecting: "Disconnecting",
  error: "Error",
};

export function jarvisStateLabel(state: JarvisState): string {
  return STATE_LABELS[state];
}

/**
 * The Meta Human OS orb. Ring treatment encodes the session state; the core scales
 * with live audio amplitude (mic level while listening, output level while
 * speaking).
 */
export function JarvisOrb({
  state,
  amplitude,
  size = 260,
  className,
}: {
  state: JarvisState;
  amplitude: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, amplitude));
  // Only amplitude-reactive states should breathe with audio.
  const reactive =
    state === "listening" ||
    state === "userSpeaking" ||
    state === "speaking" ||
    state === "transcribing";

  return (
    <div
      className={cn("jarvis-orb", className)}
      style={
        {
          width: size,
          height: size,
          "--jarvis-amplitude": reactive ? clamped.toFixed(3) : "0",
        } as React.CSSProperties
      }
      role="img"
      aria-label={`Meta Human OS status: ${STATE_LABELS[state]}`}
    >
      {/* Outer rings — the state signature. */}
      {(state === "listening" ||
        state === "userSpeaking" ||
        state === "idle") && (
        <>
          <span className="jarvis-orb-ring jarvis-orb-ring--spin-slow" />
          <span
            className="jarvis-orb-ring jarvis-orb-ring--pulse"
            style={{ inset: "12%" }}
          />
        </>
      )}

      {(state === "thinking" || state === "transcribing") && (
        <>
          <span className="jarvis-orb-ring jarvis-orb-ring--spin-slow jarvis-orb-ring--dashed" />
          <span
            className="jarvis-orb-ring jarvis-orb-ring--pulse"
            style={{ inset: "18%" }}
          />
        </>
      )}

      {state === "executingTool" && (
        <>
          <span className="jarvis-orb-ring jarvis-orb-ring--segments" />
          <span
            className="jarvis-orb-ring jarvis-orb-ring--spin"
            style={{ inset: "20%" }}
          />
        </>
      )}

      {state === "speaking" && (
        <>
          <span className="jarvis-orb-ring jarvis-orb-ring--spin" />
          <span
            className="jarvis-orb-ring jarvis-orb-ring--spin-slow"
            style={{ inset: "10%" }}
          />
          <span
            className="jarvis-orb-ring"
            style={{
              inset: "22%",
              opacity: 0.3 + clamped * 0.5,
            }}
          />
        </>
      )}

      {(state === "connecting" || state === "awaitingConfirmation") && (
        <span className="jarvis-orb-ring jarvis-orb-ring--spin jarvis-orb-ring--dashed" />
      )}

      {(state === "error" || state === "interrupted") && (
        <span className="jarvis-orb-ring jarvis-orb-ring--pulse" />
      )}

      {state === "offline" && <span className="jarvis-orb-ring" />}

      <span
        className={cn(
          "jarvis-orb-core",
          (state === "thinking" ||
            state === "connecting" ||
            state === "executingTool" ||
            state === "offline") &&
            "jarvis-orb-core--breathe",
        )}
        style={{ width: size * 0.52, height: size * 0.52 }}
      />
    </div>
  );
}

/** Compact orb used as the sidebar icon. */
export function JarvisSidebarOrb({
  isActive,
  liveState,
  className,
}: {
  isActive?: boolean;
  liveState?: JarvisState;
  className?: string;
}) {
  return (
    <span
      className={cn("jarvis-sidebar-orb shrink-0", className)}
      data-active={isActive ? "true" : "false"}
      data-live={liveState && liveState !== "offline" ? liveState : undefined}
      aria-hidden="true"
    >
      <span className="jarvis-sidebar-orb-ring" />
      <span className="jarvis-sidebar-orb-core" />
    </span>
  );
}
