import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrainiacHudCore } from "./BrainiacHudCore";

describe("BrainiacHudCore", () => {
  it("renders the Meta Human OS cockpit telemetry around the avatar", () => {
    render(<BrainiacHudCore voiceState="listening" />);

    const core = screen.getByTestId("brainiac-hud-core");
    expect(core.getAttribute("data-voice-state")).toBe("listening");
    expect(screen.getByTestId("brainiac-core-callouts").children).toHaveLength(
      4,
    );
    expect(screen.getByText("TARGETING")).toBeTruthy();
    expect(screen.getByText("VOICE IO")).toBeTruthy();
    expect(screen.getByText("VECTORS LOCKED")).toBeTruthy();
    expect(
      core.querySelector<HTMLImageElement>(".brainiac-avatar")?.src,
    ).toContain("brainiac-live-ai");
  });
});
