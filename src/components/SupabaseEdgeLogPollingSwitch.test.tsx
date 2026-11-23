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
  settingsLoading: false,
  refreshSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {};
  h.settingsLoading = false;
  h.updateSettings.mockResolvedValue(undefined);
  h.refreshSettings.mockResolvedValue(undefined);
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
    screen.getByRole("switch", {
      description: /agent can still fetch Edge Function logs on demand/,
    }),
  ).toBeTruthy();
});

it("persists turning polling on and off", () => {
  const view = render(<SupabaseEdgeLogPollingSwitch />);
  fireEvent.click(
    screen.getByText("Automatically fetch Supabase Edge Function logs"),
  );
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

it("waits for settings without flashing an off switch or allowing writes", () => {
  h.settings = null;
  h.settingsLoading = true;
  const view = render(<SupabaseEdgeLogPollingSwitch />);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Loading settings…");
  fireEvent.click(
    screen.getByText("Automatically fetch Supabase Edge Function logs"),
  );
  expect(h.updateSettings).not.toHaveBeenCalled();

  h.settingsLoading = false;
  h.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
  view.rerender(<SupabaseEdgeLogPollingSwitch />);
  expect(getToggle().getAttribute("aria-checked")).toBe("true");
});

it("lets users retry an unavailable settings read", async () => {
  h.settings = null;
  const view = render(<SupabaseEdgeLogPollingSwitch />);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(
    "Unable to load settings.",
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Retry" })),
  );
  expect(h.refreshSettings).toHaveBeenCalledTimes(1);
  expect(h.updateSettings).not.toHaveBeenCalled();

  h.settings = { autoFetchSupabaseEdgeFunctionLogs: true };
  view.rerender(<SupabaseEdgeLogPollingSwitch />);
  expect(getToggle().getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("swallows a rejected write and keeps the saved value", async () => {
  h.updateSettings.mockRejectedValueOnce(new Error("Settings write failed"));
  render(<SupabaseEdgeLogPollingSwitch />);
  await act(async () => fireEvent.click(getToggle()));
  expect(h.updateSettings).toHaveBeenCalledWith({
    autoFetchSupabaseEdgeFunctionLogs: true,
  });
  expect(getToggle().getAttribute("aria-checked")).toBe("false");
});
