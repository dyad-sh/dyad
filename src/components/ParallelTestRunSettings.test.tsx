import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown> | null,
  updateSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
import { ParallelTestRunSettings } from "./ParallelTestRunSettings";
beforeEach(() => {
  h.settings = {};
  h.updateSettings.mockReset().mockResolvedValue(undefined);
});

it("defaults parallel runs off with adaptive concurrency and configurable sandbox retention", () => {
  render(<ParallelTestRunSettings />);
  expect(
    screen
      .getByRole("switch", { name: "Allow parallel E2E test runs" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(screen.queryByLabelText("Maximum active runs")).toBeNull();
  expect(
    screen.getByText(/peak system CPU and memory stayed below 90%/),
  ).toBeTruthy();
  expect(
    screen.getByText(/queued runs wait for the active batch to finish/),
  ).toBeTruthy();
  expect(screen.getByText(/decreases by one for the whole batch/)).toBeTruthy();
  expect(
    (screen.getByLabelText("Reusable sandboxes to keep") as HTMLInputElement)
      .value,
  ).toBe("8");
  fireEvent.click(screen.getByRole("switch"));
  expect(h.updateSettings).toHaveBeenCalledWith({
    enableParallelTestRuns: true,
  });
  fireEvent.blur(screen.getByLabelText("Reusable sandboxes to keep"), {
    target: { value: "0" },
  });
  expect(h.updateSettings).toHaveBeenCalledWith({
    maxReusableTestSandboxes: 0,
  });
  fireEvent.blur(screen.getByLabelText("Reusable sandboxes to keep"), {
    target: { value: "-1" },
  });
  expect(h.updateSettings).toHaveBeenCalledTimes(2);
});

it("waits for settings before accepting changes", () => {
  h.settings = null;
  render(<ParallelTestRunSettings />);
  fireEvent.click(screen.getByRole("switch"));
  expect(h.updateSettings).not.toHaveBeenCalled();
});
