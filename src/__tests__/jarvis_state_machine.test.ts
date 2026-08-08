import { describe, expect, it, vi } from "vitest";
import {
  JarvisStateMachine,
  canTransition,
  INTERRUPTIBLE_STATES,
  MIC_ACTIVE_STATES,
  TURN_STARTABLE_STATES,
} from "@/shared/jarvis/state_machine";

describe("JarvisStateMachine", () => {
  it("starts offline and follows the connection path", () => {
    const machine = new JarvisStateMachine();
    expect(machine.state).toBe("offline");

    expect(machine.transition("connecting")).toBe(true);
    expect(machine.transition("listening")).toBe(true);
    expect(machine.state).toBe("listening");
  });

  it("rejects transitions that skip the connection sequence", () => {
    const machine = new JarvisStateMachine();
    // Cannot start speaking without ever connecting.
    expect(machine.transition("speaking")).toBe(false);
    expect(machine.state).toBe("offline");
  });

  it("ignores a repeat transition to the current state", () => {
    const machine = new JarvisStateMachine("listening");
    expect(machine.transition("listening")).toBe(false);
  });

  it("allows error and disconnecting from any live state", () => {
    for (const state of [
      "listening",
      "thinking",
      "speaking",
      "executingTool",
    ] as const) {
      expect(canTransition(state, "error")).toBe(true);
      expect(canTransition(state, "disconnecting")).toBe(true);
    }
    // An offline session has nothing to disconnect or fail.
    expect(canTransition("offline", "disconnecting")).toBe(false);
  });

  it("notifies listeners with previous and next state", () => {
    const machine = new JarvisStateMachine("thinking");
    const listener = vi.fn();
    const unsubscribe = machine.onChange(listener);

    machine.transition("speaking");
    expect(listener).toHaveBeenCalledWith("speaking", "thinking");

    unsubscribe();
    machine.transition("listening");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("prevents a new turn while one is already running", () => {
    // Thinking and executingTool are deliberately excluded so a late
    // committed transcript cannot start a duplicate turn.
    expect(TURN_STARTABLE_STATES).not.toContain("thinking");
    expect(TURN_STARTABLE_STATES).not.toContain("executingTool");
    expect(TURN_STARTABLE_STATES).toContain("listening");
    expect(TURN_STARTABLE_STATES).toContain("interrupted");
  });

  it("treats assistant output states as interruptible", () => {
    expect(INTERRUPTIBLE_STATES).toEqual([
      "thinking",
      "executingTool",
      "speaking",
    ]);
  });

  it("keeps the microphone off while offline or connecting", () => {
    expect(MIC_ACTIVE_STATES).not.toContain("offline");
    expect(MIC_ACTIVE_STATES).not.toContain("connecting");
    expect(MIC_ACTIVE_STATES).not.toContain("disconnecting");
  });

  it("routes an interruption back into a new user turn", () => {
    const machine = new JarvisStateMachine("speaking");
    expect(machine.transition("interrupted")).toBe(true);
    expect(machine.transition("userSpeaking")).toBe(true);
    expect(machine.transition("transcribing")).toBe(true);
    expect(machine.transition("thinking")).toBe(true);
  });
});
