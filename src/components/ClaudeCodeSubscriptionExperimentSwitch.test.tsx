import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ClaudeCodeSubscriptionExperimentSwitch } from "./ClaudeCodeSubscriptionExperimentSwitch";
const mocks = vi.hoisted(() => ({
  enabled: undefined as boolean | undefined,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableClaudeCodeSubscription: mocks.enabled },
    updateSettings: mocks.update,
  }),
}));
beforeEach(() => {
  mocks.enabled = undefined;
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
