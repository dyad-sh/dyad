import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiWindowExperimentSwitch } from "./MultiWindowExperimentSwitch";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableMultiWindow: false },
    updateSettings: mocks.updateSettings,
  }),
}));

describe("MultiWindowExperimentSwitch", () => {
  beforeEach(() => {
    mocks.updateSettings.mockClear();
  });

  it("opts into the multi-window product surface", () => {
    render(<MultiWindowExperimentSwitch />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Enable multiple windows" }),
    );

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableMultiWindow: true,
    });
  });
});
