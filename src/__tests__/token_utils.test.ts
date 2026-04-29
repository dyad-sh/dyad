import { describe, expect, it } from "vitest";

import {
  getCompactionThreshold,
  shouldTriggerCompaction,
} from "@/ipc/utils/token_utils";

describe("token_utils compaction threshold", () => {
  it("uses explicit compaction window when one is provided", () => {
    expect(getCompactionThreshold(200_000, 50_000)).toBe(50_000);
    expect(shouldTriggerCompaction(49_999, 200_000, 50_000)).toBe(false);
    expect(shouldTriggerCompaction(50_000, 200_000, 50_000)).toBe(true);
  });

  it("keeps existing threshold behavior without an explicit compaction window", () => {
    expect(getCompactionThreshold(200_000)).toBe(160_000);
    expect(getCompactionThreshold(400_000)).toBe(180_000);
  });
});
