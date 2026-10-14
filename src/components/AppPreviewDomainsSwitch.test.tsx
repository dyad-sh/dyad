import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppPreviewDomainsSwitch } from "./AppPreviewDomainsSwitch";

const mocks = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | undefined,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => mocks,
}));

describe("AppPreviewDomainsSwitch", () => {
  beforeEach(() => {
    mocks.settings = undefined;
    mocks.updateSettings.mockReset().mockResolvedValue(undefined);
  });

  it("waits for settings before allowing changes", () => {
    render(<AppPreviewDomainsSwitch />);
    fireEvent.click(screen.getByRole("switch"));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])(
    "shows and toggles the stored preference %s, defaulting to off",
    (enabled) => {
      mocks.settings = { enableAppPreviewDomains: enabled };
      render(<AppPreviewDomainsSwitch />);
      const toggle = screen.getByRole("switch", {
        name: "App-specific localhost domains",
      });
      expect(toggle.getAttribute("aria-checked")).toBe(String(!!enabled));
      fireEvent.click(toggle);
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        enableAppPreviewDomains: !enabled,
      });
    },
  );
});
