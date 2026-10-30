import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { App } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import { DatabaseSection } from "./DatabaseSection";

const h = vi.hoisted(() => ({
  app: {} as App,
  settings: {} as Partial<UserSettings> | null,
  save: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: h.settings }),
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: h.app, refreshApp: async () => {} }),
}));
vi.mock("@/hooks/useNeon", () => ({
  useNeon: () => ({
    branches: [
      { type: "production", branchId: "prod" },
      { type: "development", branchId: "dev" },
    ],
    isLoadingBranches: false,
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    neon: { setSelectedDatabaseBranchType: h.save },
    vercel: { syncNeonConfig: h.sync },
  },
}));
vi.mock("@/components/MigrationPanel", () => ({
  MigrationPanelBody: () => <div>Review migration</div>,
}));
vi.mock("./DatabaseEnvVars", () => ({
  DatabaseEnvVars: ({ branchType }: { branchType: string }) => (
    <div>{branchType} environment</div>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

let client: QueryClient;
const key = (suffix: string) => `integrations.database.${suffix}`;
const safety = (suffix: string) => `integrations.neon.branchSafety.${suffix}`;
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <DatabaseSection appId={h.app.id} />
    </QueryClientProvider>,
  );
}
const next = () =>
  screen.getByRole("button", { name: key("continue") }) as HTMLButtonElement;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  h.settings = {};
  h.app = {
    id: 1,
    neonProjectId: "neon",
    neonActiveBranchId: "dev",
    neonDevelopmentBranchId: "dev",
    selectedDatabaseBranchType: null,
    deploymentProvidersInUse: {},
  } as App;
  h.save.mockImplementation(async ({ branchType }) => {
    h.app = { ...h.app, selectedDatabaseBranchType: branchType };
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it.each([null, {}, { enableNeonBranchProtection: true }])(
  "hides development for a new selection with settings %j",
  (settings) => {
    h.settings = settings;
    mount();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(key("development.title")),
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(key("production.title")) }),
    );
    expect(next().disabled).toBe(false);
  },
);

it("allows development without an acknowledgment checkbox when protection is disabled", async () => {
  h.settings = { enableNeonBranchProtection: false };
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(key("development.title")) }),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    safety("deploymentWarning"),
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(next().disabled).toBe(false);
  fireEvent.click(next());
  await screen.findByText("development environment");
  expect(h.save).toHaveBeenCalledWith({ appId: 1, branchType: "development" });
});

it.each([true, false])(
  "keeps existing development selections available with protection %s, and steers to production",
  async (enabled) => {
    h.settings = { enableNeonBranchProtection: enabled };
    h.app.selectedDatabaseBranchType = "development";
    mount();
    expect(screen.getByRole("alert").textContent).toContain(
      safety("deploymentWarning"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: key("backToSelection") }),
    );
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(key("development.title")),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: safety("deploymentRecommended") }),
    );
    fireEvent.click(next());
    await screen.findByText("Review migration");
    expect(h.save).toHaveBeenCalledWith({ appId: 1, branchType: "production" });
    if (enabled) {
      fireEvent.click(
        screen.getByRole("button", { name: key("backToSelection") }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", {
            name: new RegExp(key("development.title")),
          }),
        ).toBeNull(),
      );
    }
  },
);

it("offers a direct safe replacement without changing the active development branch", async () => {
  h.app.selectedDatabaseBranchType = "development";
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: safety("deploymentRecommended") }),
  );
  await screen.findByText("production environment");
  expect(h.app.neonActiveBranchId).toBe("dev");
});

it("does not offer a missing development branch even with protection disabled", () => {
  h.settings = { enableNeonBranchProtection: false };
  h.app.neonDevelopmentBranchId = null;
  mount();
  expect(
    screen.queryByRole("button", {
      name: new RegExp(key("development.title")),
    }),
  ).toBeNull();
});
