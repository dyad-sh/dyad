import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellExperimentSwitch } from "./ShellExperimentSwitch";
const mocks = vi.hoisted(() => ({ pro: true, updateSettings: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableShellTool: false,
      enableDyadPro: mocks.pro,
      providerSettings: { auto: { apiKey: { value: "test" } } },
    },
    updateSettings: mocks.updateSettings,
  }),
}));
afterEach(() => {
  cleanup();
  mocks.pro = true;
  mocks.updateSettings.mockClear();
});
describe("Shell experiment", () => {
  it("persists the top-level setting", () => {
    render(<ShellExperimentSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Shell tool (Pro)" }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableShellTool: true,
    });
  });
  it("does not allow non-Pro users to enable it", () => {
    mocks.pro = false;
    render(<ShellExperimentSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Shell tool (Pro)" }));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
