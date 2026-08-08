export type BrainiacVoiceState = "idle" | "listening" | "speaking" | "thinking";

export const BRAINIAC_VOICE_STATE_LABEL: Record<BrainiacVoiceState, string> = {
  idle: "IDLE",
  listening: "LISTENING",
  speaking: "SPEAKING",
  thinking: "THINKING",
};

export function isBrainiacVoiceActive(state: BrainiacVoiceState) {
  return state !== "idle";
}

/** Eye glow when mic is live or agent is speaking. */
export function brainiacEyesActive(state: BrainiacVoiceState) {
  return state === "listening" || state === "speaking";
}

/** Chest power orb visible when not actively talking. */
export function brainiacOrbVisible(state: BrainiacVoiceState) {
  return state === "idle" || state === "thinking";
}
