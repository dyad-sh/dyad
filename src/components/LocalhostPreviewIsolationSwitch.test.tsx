import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | undefined,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: h.settings,
    updateSettings: h.updateSettings,
  }),
}));

import { LocalhostPreviewIsolationSwitch } from "./LocalhostPreviewIsolationSwitch";

beforeEach(() => {
  h.settings = undefined;
  h.updateSettings.mockReset().mockResolvedValue(undefined);
});

describe("LocalhostPreviewIsolationSwitch", () => {
  it("shows the enabled default but stays inert until settings load", () => {
    render(<LocalhostPreviewIsolationSwitch />);

    const toggle = screen.getByRole("switch", {
      name: "Isolate local preview data",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
    fireEvent.click(toggle);
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("persists the user's explicit opt-out", () => {
    h.settings = { enableLocalhostPreviewIsolation: true };
    render(<LocalhostPreviewIsolationSwitch />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Isolate local preview data" }),
    );

    expect(h.updateSettings).toHaveBeenCalledWith({
      enableLocalhostPreviewIsolation: false,
    });
  });
});
