import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("defaults parallel runs off and the concurrency limit to two", () => {
  render(<ParallelTestRunSettings />);
  const toggle = screen.getByRole("switch", {
    name: "Allow parallel E2E test runs",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  const input = screen.getByRole("spinbutton", {
    name: "Maximum concurrent test runs",
  }) as HTMLInputElement;
  expect(input.value).toBe("2");
  expect(input.disabled).toBe(true);
  fireEvent.click(toggle);
  expect(h.updateSettings).toHaveBeenCalledWith({
    enableParallelTestRuns: true,
  });
});

it("displays and updates the saved concurrency limit", () => {
  h.settings = { enableParallelTestRuns: true, maxConcurrentTestRuns: 3 };
  const { rerender } = render(<ParallelTestRunSettings />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  expect(input.value).toBe("3");
  expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "4" } });
  fireEvent.blur(input);
  expect(h.updateSettings).toHaveBeenCalledWith({ maxConcurrentTestRuns: 4 });
  h.settings = { enableParallelTestRuns: true, maxConcurrentTestRuns: 5 };
  rerender(<ParallelTestRunSettings />);
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("5");
});

it.each(["", "0", "-1", "1.5", "129"])(
  "rejects invalid concurrency %s",
  (value) => {
    h.settings = { enableParallelTestRuns: true, maxConcurrentTestRuns: 3 };
    render(<ParallelTestRunSettings />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(input.value).toBe("3");
  },
);

it("restores the saved limit when persistence fails", async () => {
  h.settings = { enableParallelTestRuns: true };
  h.updateSettings.mockRejectedValue(new Error("Could not save settings"));
  render(<ParallelTestRunSettings />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.blur(input);
  await waitFor(() => expect(input.value).toBe("2"));
});

it("waits for settings before accepting changes", () => {
  h.settings = null;
  render(<ParallelTestRunSettings />);
  fireEvent.click(screen.getByRole("switch"));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(h.updateSettings).not.toHaveBeenCalled();
});
