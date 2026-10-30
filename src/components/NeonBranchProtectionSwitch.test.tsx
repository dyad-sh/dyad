import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { NeonBranchProtectionSwitch } from "./NeonBranchProtectionSwitch";

const h = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  refreshSettings: vi.fn(),
  settings: {} as Partial<UserSettings> | null,
  settingsLoading: false,
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {};
  h.settingsLoading = false;
  h.updateSettings.mockResolvedValue(undefined);
  h.refreshSettings.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("defaults to protection and persists the explicit opt-out", () => {
  render(<NeonBranchProtectionSwitch />);
  const toggle = screen.getByRole("switch", {
    name: "Protect Neon database branches",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  expect(h.updateSettings).toHaveBeenCalledWith({
    enableNeonBranchProtection: false,
  });
});

it.each([true, false])("waits for saved settings (loading: %s)", (loading) => {
  h.settings = null;
  h.settingsLoading = loading;
  const view = render(<NeonBranchProtectionSwitch />);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    `integrations.neon.branchSafety.${loading ? "settingsLoading" : "settingsUnavailable"}`,
  );
  if (!loading) {
    fireEvent.click(
      screen.getByRole("button", { name: "integrations.neon.retry" }),
    );
    expect(h.refreshSettings).toHaveBeenCalledOnce();
  }
  h.settings = { enableNeonBranchProtection: false };
  h.settingsLoading = false;
  view.rerender(<NeonBranchProtectionSwitch />);
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});

it("handles a rejected settings write and retains the saved value", async () => {
  h.updateSettings.mockRejectedValueOnce(new Error("Settings write failed"));
  render(<NeonBranchProtectionSwitch />);
  await act(async () => fireEvent.click(screen.getByRole("switch")));
  expect(h.updateSettings).toHaveBeenCalledWith({
    enableNeonBranchProtection: false,
  });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
});
