import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown> | null,
  updateSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
import { ReusableTestSandboxSettings } from "./ReusableTestSandboxSettings";

beforeEach(() => {
  h.settings = {};
  h.updateSettings.mockReset().mockResolvedValue(undefined);
});

it("defaults retention to eight and allows disabling reuse", () => {
  render(<ReusableTestSandboxSettings />);
  const input = screen.getByRole("spinbutton", {
    name: "Reusable sandboxes to keep",
  }) as HTMLInputElement;
  expect(input.value).toBe("8");
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.blur(input);
  expect(h.updateSettings).toHaveBeenCalledWith({
    maxReusableTestSandboxes: 0,
  });
});

it.each(["", "-1", "1.5", "129"])("rejects invalid retention %s", (value) => {
  h.settings = { maxReusableTestSandboxes: 4 };
  render(<ReusableTestSandboxSettings />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  expect(h.updateSettings).not.toHaveBeenCalled();
  expect(input.value).toBe("4");
});

it("waits for settings before accepting changes", () => {
  h.settings = null;
  render(<ReusableTestSandboxSettings />);
  expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(
    true,
  );
});
