import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { SupabaseEdgeLogPollingHint } from "./SupabaseEdgeLogPollingHint";

const h = vi.hoisted(() => ({
  settings: {} as Partial<UserSettings> | null,
  navigate: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => h }));
vi.mock("@/hooks/useScrollAndNavigateTo", () => ({
  useScrollAndNavigateTo: () => h.navigate,
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {};
  h.navigate.mockResolvedValue(true);
});
afterEach(cleanup);

it("explains disabled polling and opens its exact setting", async () => {
  render(<SupabaseEdgeLogPollingHint />);
  expect(
    screen.getByText(/Automatic Supabase Edge Function logs are off/),
  ).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Open log settings" })),
  );
  expect(h.navigate).toHaveBeenCalledWith(
    SETTING_IDS.autoFetchSupabaseEdgeFunctionLogs,
    SECTION_IDS.integrations,
  );
});

it.each([null, { autoFetchSupabaseEdgeFunctionLogs: true }])(
  "hides the hint while settings load or polling is enabled: %j",
  (settings) => {
    h.settings = settings;
    const { container } = render(<SupabaseEdgeLogPollingHint />);
    expect(container.textContent).toBe("");
  },
);
