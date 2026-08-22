import { describe, expect, it, vi } from "vitest";

import { applySubagentLifecycleTransition } from "./controller";
import { subagentLifecycleState } from "./state";

describe("applySubagentLifecycleTransition", () => {
  it("does not persist ignored transitions", async () => {
    const persist = vi.fn();
    const result = await applySubagentLifecycleTransition({
      state: subagentLifecycleState({ status: "completed" }),
      event: { type: "START" },
      persist,
    });
    expect(result).toMatchObject({ kind: "ignored" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("returns conflict when compare-and-set persistence loses", async () => {
    const result = await applySubagentLifecycleTransition({
      state: subagentLifecycleState({ status: "queued" }),
      event: { type: "START" },
      now: new Date(123),
      persist: vi.fn().mockResolvedValue(false),
    });
    expect(result).toEqual({ kind: "conflict" });
  });

  it("persists a stop request without pretending the run completed", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const state = subagentLifecycleState({ status: "running" });
    await applySubagentLifecycleTransition({
      state,
      event: { type: "REQUEST_STOP" },
      now: new Date(123),
      persist,
    });
    expect(persist).toHaveBeenCalledWith(state, {
      status: "stopping",
      error: null,
      updatedAt: new Date(123),
    });
  });

  it("projects transition metadata only after an accepted transition", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const state = subagentLifecycleState({ status: "completed" });
    const result = await applySubagentLifecycleTransition({
      state,
      event: {
        type: "BEGIN_AUTO_FIX_COUNTDOWN",
        autoFixAtMs: 500,
      },
      now: new Date(123),
      persist,
    });
    expect(result).toMatchObject({
      kind: "applied",
      state: { status: "auto_fix_countdown" },
    });
    expect(persist).toHaveBeenCalledWith(state, {
      status: "auto_fix_countdown",
      autoFixAt: new Date(500),
      updatedAt: new Date(123),
    });
  });
});
