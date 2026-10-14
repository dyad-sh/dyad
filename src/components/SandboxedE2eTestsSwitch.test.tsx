import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: null as null | { disableSandboxedE2eTests: boolean },
  loading: true,
  updateSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
import { SandboxedE2eTestsSwitch } from "./SandboxedE2eTestsSwitch";

beforeEach(() => {
  h.settings = null;
  h.loading = true;
  h.updateSettings.mockReset().mockResolvedValue(undefined);
});

it("explains loading and prevents changes before settings arrive", () => {
  render(<SandboxedE2eTestsSwitch />);
  fireEvent.click(screen.getByRole("switch"));
  expect(h.updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("Loading settings");
});

it("explains a settings query failure", () => {
  h.loading = false;
  render(<SandboxedE2eTestsSwitch />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Couldn't load settings",
  );
});

it("handles a rejected settings write after the mutation reports it", async () => {
  h.settings = { disableSandboxedE2eTests: false };
  h.loading = false;
  h.updateSettings.mockRejectedValueOnce(new Error("write failed"));
  render(<SandboxedE2eTestsSwitch />);
  fireEvent.click(screen.getByRole("switch"));
  await Promise.resolve();
  expect(h.updateSettings).toHaveBeenCalledWith({
    disableSandboxedE2eTests: true,
  });
});
