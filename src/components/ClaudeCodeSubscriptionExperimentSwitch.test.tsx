import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ClaudeCodeSubscriptionExperimentSwitch } from "./ClaudeCodeSubscriptionExperimentSwitch";
const mocks = vi.hoisted(() => ({
  enabled: undefined as boolean | undefined,
  native: undefined as boolean | undefined,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableClaudeCodeSubscription: mocks.enabled,
      enableClaudeCodeNativeTools: mocks.native,
    },
    updateSettings: mocks.update,
  }),
}));
beforeEach(() => {
  mocks.enabled = undefined;
  mocks.native = undefined;
  mocks.update.mockReset();
});
it("defaults off and persists a top-level opt-in", () => {
  render(<ClaudeCodeSubscriptionExperimentSwitch />);
  const toggle = screen.getByRole("switch", {
    name: "Enable Claude Code subscription",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(mocks.update).toHaveBeenCalledWith({
    enableClaudeCodeSubscription: true,
  });
});
it("can disable an enabled experiment without altering model or chat settings", () => {
  mocks.enabled = true;
  render(<ClaudeCodeSubscriptionExperimentSwitch />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Enable Claude Code subscription" }),
  );
  expect(mocks.update).toHaveBeenCalledWith({
    enableClaudeCodeSubscription: false,
  });
});
it("keeps the native tools switch disabled until Claude Code is enabled", () => {
  mocks.native = true;
  render(<ClaudeCodeSubscriptionExperimentSwitch />);
  const toggle = screen.getByRole("switch", {
    name: "Use native Claude Code tools",
  });
  // A remembered opt-in must not read as active while the parent is off.
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(
    toggle.hasAttribute("disabled") ||
      toggle.getAttribute("aria-disabled") === "true",
  ).toBe(true);
});
it("persists the native tools opt-in independently of the parent experiment", () => {
  mocks.enabled = true;
  render(<ClaudeCodeSubscriptionExperimentSwitch />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Use native Claude Code tools" }),
  );
  expect(mocks.update).toHaveBeenCalledWith({
    enableClaudeCodeNativeTools: true,
  });
});
