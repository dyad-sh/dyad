import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { SupabaseEdgeLogPollingSwitch } from "./SupabaseEdgeLogPollingSwitch";

const h = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  settings: {} as Partial<UserSettings> | null,
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {};
  h.updateSettings.mockResolvedValue(undefined);
});
afterEach(cleanup);

function getToggle() {
  return screen.getByRole("switch", {
    name: "Automatically fetch Supabase Edge Function logs",
  });
}

it("defaults to off for users without a saved preference", () => {
  render(<SupabaseEdgeLogPollingSwitch />);
  expect(getToggle().getAttribute("aria-checked")).toBe("false");
  expect(
    screen.getByText(/agent can still fetch Edge Function logs on demand/),
  ).toBeTruthy();
});

it("persists turning polling on and off", () => {
  const view = render(<SupabaseEdgeLogPollingSwitch />);
  fireEvent.click(getToggle());
  expect(h.updateSettings).toHaveBeenLastCalledWith({
    autoFetchSupabaseEdgeFunctionLogs: true,
  });

  h.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
  view.rerender(<SupabaseEdgeLogPollingSwitch />);
  expect(getToggle().getAttribute("aria-checked")).toBe("true");
  fireEvent.click(getToggle());
  expect(h.updateSettings).toHaveBeenLastCalledWith({
    autoFetchSupabaseEdgeFunctionLogs: false,
  });
});

it("is disabled until settings load", () => {
  h.settings = null;
  render(<SupabaseEdgeLogPollingSwitch />);
  expect(getToggle().hasAttribute("data-disabled")).toBe(true);
});

it("swallows a rejected write and keeps the saved value", async () => {
  h.updateSettings.mockRejectedValueOnce(new Error("Settings write failed"));
  render(<SupabaseEdgeLogPollingSwitch />);
  await act(async () => fireEvent.click(getToggle()));
  expect(getToggle().getAttribute("aria-checked")).toBe("false");
});
