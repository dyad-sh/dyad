/**
 * Meta Human OS session state machine.
 *
 * Pure, dependency-free logic shared by the main-process session manager
 * (the authoritative copy) and the renderer (which mirrors state via IPC
 * events). All state changes must go through `transition()` so conflicting
 * states (e.g. speaking while listening to our own output, duplicate tool
 * requests after cancellation) are structurally impossible.
 */

export const JARVIS_STATES = [
  "offline",
  "connecting",
  "idle",
  "listening",
  "userSpeaking",
  "transcribing",
  "thinking",
  "executingTool",
  "awaitingConfirmation",
  "speaking",
  "interrupted",
  "disconnecting",
  "error",
] as const;

export type JarvisState = (typeof JARVIS_STATES)[number];

/**
 * States in which committed user speech may start a new LLM turn.
 * Prevents duplicate turns while one is already thinking/executing.
 */
export const TURN_STARTABLE_STATES: readonly JarvisState[] = [
  "idle",
  "listening",
  "userSpeaking",
  "transcribing",
  "interrupted",
];

/** States in which microphone audio should be forwarded to STT. */
export const MIC_ACTIVE_STATES: readonly JarvisState[] = [
  "listening",
  "userSpeaking",
  "transcribing",
  "thinking",
  "executingTool",
  "awaitingConfirmation",
  "speaking",
  "interrupted",
];

/** States in which user speech constitutes a barge-in on assistant output. */
export const INTERRUPTIBLE_STATES: readonly JarvisState[] = [
  "thinking",
  "executingTool",
  "speaking",
];

const TRANSITIONS: Record<JarvisState, readonly JarvisState[]> = {
  offline: ["connecting"],
  connecting: ["idle", "listening"],
  // The assistant can speak from idle/listening without a preceding user
  // turn — the activation greeting and "repeat that" both do this.
  idle: ["listening", "thinking", "speaking"],
  listening: ["userSpeaking", "transcribing", "thinking", "speaking", "idle"],
  userSpeaking: ["transcribing", "listening", "thinking"],
  transcribing: ["thinking", "listening", "userSpeaking"],
  thinking: [
    "executingTool",
    "awaitingConfirmation",
    "speaking",
    "listening",
    "idle",
    "interrupted",
  ],
  executingTool: [
    "thinking",
    "awaitingConfirmation",
    "speaking",
    "listening",
    "idle",
    "interrupted",
  ],
  awaitingConfirmation: [
    "thinking",
    "executingTool",
    "speaking",
    "listening",
    "idle",
  ],
  speaking: ["listening", "idle", "interrupted", "thinking"],
  interrupted: [
    "userSpeaking",
    "transcribing",
    "thinking",
    "listening",
    "idle",
  ],
  disconnecting: ["offline"],
  error: ["connecting", "idle", "listening", "offline"],
};

/** Transitions permitted from any state. */
const UNIVERSAL_TARGETS: readonly JarvisState[] = ["error", "disconnecting"];

export function canTransition(from: JarvisState, to: JarvisState): boolean {
  if (from === to) return false;
  if (UNIVERSAL_TARGETS.includes(to) && from !== "offline") return true;
  return TRANSITIONS[from].includes(to);
}

export type JarvisStateListener = (
  state: JarvisState,
  previous: JarvisState,
) => void;

export class JarvisStateMachine {
  private current: JarvisState;
  private listeners = new Set<JarvisStateListener>();

  constructor(initial: JarvisState = "offline") {
    this.current = initial;
  }

  get state(): JarvisState {
    return this.current;
  }

  is(...states: JarvisState[]): boolean {
    return states.includes(this.current);
  }

  canTransition(to: JarvisState): boolean {
    return canTransition(this.current, to);
  }

  /**
   * Attempt a transition. Returns true when the transition happened.
   * Invalid transitions are ignored (returning false) rather than throwing:
   * voice events race (e.g. a late speech-end after an interruption) and the
   * machine's job is to absorb those races, not crash the session.
   */
  transition(to: JarvisState): boolean {
    if (!canTransition(this.current, to)) {
      return false;
    }
    const previous = this.current;
    this.current = to;
    for (const listener of this.listeners) {
      listener(to, previous);
    }
    return true;
  }

  onChange(listener: JarvisStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
