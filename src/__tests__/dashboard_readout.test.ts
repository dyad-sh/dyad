import { describe, expect, it } from "vitest";

import {
  UNKNOWN_READOUT,
  formatRatio,
  formatReadout,
} from "@/lib/dashboard/readout";

/**
 * The readouts sit under the orb and look authoritative, which is exactly why
 * they must not show a number they do not have. "Not loaded" and "none" are
 * different answers and have to look different.
 */
describe("HUD readouts", () => {
  it("shows a dash rather than a zero when the count is unknown", () => {
    expect(formatReadout(null)).toBe(UNKNOWN_READOUT);
    expect(formatReadout(undefined)).toBe(UNKNOWN_READOUT);
    expect(formatReadout(null)).not.toBe("0");
  });

  it("shows a real zero as a zero", () => {
    // None is a fact, and a fact should be stated.
    expect(formatReadout(0)).toBe("0");
  });

  it("groups large counts so they stay readable", () => {
    expect(formatReadout(4318)).toBe((4318).toLocaleString());
  });

  it("shows a dash for a ratio with no total", () => {
    expect(formatRatio(3, null)).toBe(UNKNOWN_READOUT);
    expect(formatRatio(null, null)).toBe(UNKNOWN_READOUT);
  });

  it("reads a known total even when the healthy count has not arrived", () => {
    // Zero healthy of four is the honest reading; the total is what was asked.
    expect(formatRatio(null, 4)).toBe("0/4");
    expect(formatRatio(3, 4)).toBe("3/4");
  });
});
