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

import { TestRunInPreviewSwitch } from "./TestRunInPreviewSwitch";

beforeEach(() => {
  h.settings = undefined;
  h.updateSettings.mockReset().mockResolvedValue(undefined);
});

describe("TestRunInPreviewSwitch", () => {
  it("stays inert until settings load", () => {
    // Before the query resolves the switch reads `false` whatever is stored,
    // so a click here would persist the opposite of what the user sees a
    // moment later.
    render(<TestRunInPreviewSwitch />);

    const toggle = screen.getByRole("switch", {
      name: "Run tests in preview panel",
    });
    fireEvent.click(toggle);

    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("persists the flip once settings are available", () => {
    h.settings = { enableTestRunInPreview: false };
    render(<TestRunInPreviewSwitch />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Run tests in preview panel" }),
    );

    expect(h.updateSettings).toHaveBeenCalledWith({
      enableTestRunInPreview: true,
    });
  });

  it("says the debugging port outlives the run", () => {
    // The exposure lasts the whole session, which is the part a user deciding
    // whether to enable this needs to weigh.
    h.settings = { enableTestRunInPreview: false };
    render(<TestRunInPreviewSwitch />);

    expect(screen.getByText(/whole/i).textContent).toContain(
      "not just while tests run",
    );
  });
});
