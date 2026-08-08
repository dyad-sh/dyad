import { describe, expect, it } from "vitest";

import {
  GENERATION_STAGES,
  stageIndexForElapsed,
  visibleStages,
} from "@/lib/image_generation_stages";

describe("stageIndexForElapsed", () => {
  it("starts on the first stage", () => {
    expect(stageIndexForElapsed(0)).toBe(0);
    expect(stageIndexForElapsed(500)).toBe(0);
  });

  it("advances as time passes", () => {
    expect(stageIndexForElapsed(2000)).toBe(1);
    expect(stageIndexForElapsed(5000)).toBe(2);
    expect(stageIndexForElapsed(11_000)).toBe(4);
  });

  it("holds on the last stage instead of running out", () => {
    // A slow generation should read as "Finalizing", not as finished or stuck.
    const last = GENERATION_STAGES.length - 1;
    expect(stageIndexForElapsed(60_000)).toBe(last);
    expect(stageIndexForElapsed(10 * 60_000)).toBe(last);
  });

  it("never goes backwards", () => {
    let previous = -1;
    for (let ms = 0; ms < 40_000; ms += 250) {
      const index = stageIndexForElapsed(ms);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });

  it("copes with nonsense input", () => {
    expect(stageIndexForElapsed(-100)).toBe(0);
    expect(stageIndexForElapsed(Number.NaN)).toBe(0);
  });

  it("has stages in increasing time order", () => {
    for (let i = 1; i < GENERATION_STAGES.length; i += 1) {
      expect(GENERATION_STAGES[i].startsAtMs).toBeGreaterThan(
        GENERATION_STAGES[i - 1].startsAtMs,
      );
    }
  });
});

describe("visibleStages", () => {
  it("shows exactly one active stage", () => {
    for (let index = 0; index < GENERATION_STAGES.length; index += 1) {
      const active = visibleStages(index).filter(
        (row) => row.state === "active",
      );
      expect(active).toHaveLength(1);
      expect(active[0].index).toBe(index);
    }
  });

  it("shows completed stages before the active one", () => {
    const rows = visibleStages(3);
    expect(
      rows.filter((row) => row.state === "done").map((r) => r.index),
    ).toEqual([1, 2]);
  });

  it("shows the next stage as upcoming", () => {
    const rows = visibleStages(2);
    expect(rows.find((row) => row.state === "upcoming")?.index).toBe(3);
  });

  it("has no upcoming stage once on the last one", () => {
    const rows = visibleStages(GENERATION_STAGES.length - 1);
    expect(rows.some((row) => row.state === "upcoming")).toBe(false);
  });

  it("does not run off the start of the list", () => {
    const rows = visibleStages(0);
    expect(rows[0].index).toBe(0);
    expect(rows.every((row) => row.index >= 0)).toBe(true);
  });

  it("keeps the window small enough to read", () => {
    for (let index = 0; index < GENERATION_STAGES.length; index += 1) {
      expect(visibleStages(index).length).toBeLessThanOrEqual(4);
    }
  });
});
