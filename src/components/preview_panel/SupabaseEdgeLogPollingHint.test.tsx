import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStore, Provider } from "jotai";
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

const credentials = {
  accessToken: { value: "token" },
  refreshToken: { value: "refresh" },
  expiresIn: 3600,
  tokenTimestamp: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {
    supabase: { organizations: { org: credentials } },
  };
  h.navigate.mockResolvedValue(true);
});
afterEach(cleanup);

function renderHint(store = createStore()) {
  return render(
    <Provider store={store}>
      <SupabaseEdgeLogPollingHint organizationSlug="org" />
    </Provider>,
  );
}

it("explains disabled polling and opens its exact setting", async () => {
  renderHint();
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

it.each([
  "loading",
  "enabled",
  "no credentials",
  "other organization",
  "legacy only",
])("hides the hint for %s", (state) => {
  if (state === "loading") h.settings = null;
  if (state === "enabled") h.settings!.autoFetchSupabaseEdgeFunctionLogs = true;
  if (state === "no credentials") h.settings = {};
  if (state === "other organization")
    h.settings = {
      supabase: {
        organizations: { other: credentials },
      },
    };
  if (state === "legacy only")
    h.settings = { supabase: { accessToken: { value: "token" } } };
  const { container } = renderHint();
  expect(container.textContent).toBe("");
});

it("keeps a dismissal across console remounts in the same window", () => {
  const store = createStore();
  const first = renderHint(store);
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss Supabase log polling hint" }),
  );
  expect(first.container.textContent).toBe("");
  first.unmount();
  expect(renderHint(store).container.textContent).toBe("");
});
