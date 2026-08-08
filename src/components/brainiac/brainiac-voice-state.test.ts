import { describe, expect, it } from "vitest";
import { brainiacEyesActive, brainiacOrbVisible } from "./brainiac-voice-state";

describe("brainiac voice visuals", () => {
  it("flashes eyes when listening or speaking", () => {
    expect(brainiacEyesActive("idle")).toBe(false);
    expect(brainiacEyesActive("thinking")).toBe(false);
    expect(brainiacEyesActive("listening")).toBe(true);
    expect(brainiacEyesActive("speaking")).toBe(true);
  });

  it("shows chest orb when idle or thinking", () => {
    expect(brainiacOrbVisible("idle")).toBe(true);
    expect(brainiacOrbVisible("thinking")).toBe(true);
    expect(brainiacOrbVisible("listening")).toBe(false);
    expect(brainiacOrbVisible("speaking")).toBe(false);
  });
});
