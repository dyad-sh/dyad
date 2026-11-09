import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorktreeIsolationSettings } from "./WorktreeIsolationSettings";

const mocks = vi.hoisted(() => ({
  settings: undefined as { enableWorktreeIsolation?: boolean } | undefined,
  update: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.update,
  }),
}));

beforeEach(() => {
  mocks.settings = undefined;
  mocks.update.mockReset();
  mocks.update.mockResolvedValue(undefined);
});

it("cannot be toggled before settings load", () => {
  render(<WorktreeIsolationSettings />);
  const toggle = screen.getByRole("switch", { name: "Worktree isolation" });
  // Clicking now would send the opposite of the stored value.
  expect(
    toggle.getAttribute("aria-disabled") === "true" ||
      toggle.hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(toggle);
  expect(mocks.update).not.toHaveBeenCalled();
});

it("turns isolation on and explains how worktrees are kept", () => {
  mocks.settings = {};
  const { rerender } = render(<WorktreeIsolationSettings />);
  fireEvent.click(screen.getByRole("switch", { name: "Worktree isolation" }));
  expect(mocks.update).toHaveBeenCalledWith({ enableWorktreeIsolation: true });
  expect(screen.queryByText(/Worktrees are kept/)).toBeNull();

  mocks.settings = { enableWorktreeIsolation: true };
  rerender(<WorktreeIsolationSettings />);
  expect(
    screen.getByText(/Worktrees are kept after their work is merged/),
  ).toBeTruthy();
  // There is no longer a per-app limit or idle cleanup to configure.
  expect(screen.queryByText(/per app/)).toBeNull();
  expect(screen.queryByText(/Clean up idle/)).toBeNull();
});
