import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NeonBranchProtectionSwitch } from "./NeonBranchProtectionSwitch";

const h = vi.hoisted(() => ({ updateSettings: vi.fn(), settings: {} }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
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
