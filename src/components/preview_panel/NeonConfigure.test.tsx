import {
  focusManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import {
  NEON_PROJECT_ACCESS_DENIED_MESSAGE,
  NEON_PROJECT_NOT_FOUND_MESSAGE,
  NEON_RECONNECT_REQUIRED_MESSAGE,
} from "@/shared/neon_auth";

const h = vi.hoisted(() => ({
  getApp: vi.fn(),
  getSettings: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  getEmailPasswordConfig: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { getApp: h.getApp },
    neon: {
      getProject: h.getProject,
      listProjects: h.listProjects,
      getEmailPasswordConfig: h.getEmailPasswordConfig,
    },
  },
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => {
    const { data: settings } = useQuery({
      queryKey: queryKeys.settings.user,
      queryFn: h.getSettings,
      staleTime: Infinity,
    });
    return { settings };
  },
}));
vi.mock("@/components/NeonSignInButton", () => ({
  NeonSignInButton: ({ appId }: { appId: number }) => (
    <button data-app-id={appId}>Reconnect Neon</button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { NeonConfigure } from "./NeonConfigure";

let client: QueryClient;
let store: ReturnType<typeof createStore>;

function panel() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <NeonConfigure />
      </QueryClientProvider>
    </Provider>
  );
}

async function refocus() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  store = createStore();
  store.set(selectedAppIdAtom, 1);
  // Mirror the renderer's global error-toast policy without importing its entry point.
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.showErrorToast) h.showError(error);
      },
    }),
  });
  h.getSettings.mockResolvedValue({
    neon: { accessToken: { value: "access-token" } },
  });
  h.getApp.mockResolvedValue({
    id: 1,
    neonProjectId: "project",
    neonDevelopmentBranchId: "dev",
  });
  h.getProject.mockResolvedValue({
    projectId: "project",
    projectName: "Demo database",
    orgId: "organization",
    branches: [
      {
        branchId: "dev",
        branchName: "dev-branch",
        type: "development",
        lastUpdated: "2026-01-01T00:00:00Z",
      },
    ],
  });
  h.listProjects.mockResolvedValue({ projects: [] });
  h.getEmailPasswordConfig.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  client.clear();
  focusManager.setFocused(undefined);
});

it.each([
  ["missing credentials", {}],
  [
    "rejected credentials",
    { neon: { accessToken: { value: "old-token" }, reconnectRequired: true } },
  ],
] satisfies [string, Partial<UserSettings>][])(
  "shows reconnection without requests or toasts for %s, including refocus and remount",
  async (_, settings) => {
    h.getSettings.mockResolvedValue(settings);
    const view = render(panel());
    const reconnect = await screen.findByRole("button", {
      name: "Reconnect Neon",
    });
    expect(reconnect.getAttribute("data-app-id")).toBe("1");
    await refocus();
    view.unmount();
    render(panel());
    await screen.findByTestId("neon-reconnection-notice");
    await refocus();

    expect(h.getProject).not.toHaveBeenCalled();
    expect(h.listProjects).not.toHaveBeenCalled();
    expect(h.getEmailPasswordConfig).not.toHaveBeenCalled();
    expect(h.showError).not.toHaveBeenCalled();
  },
);

it("waits for settings, then loads the linked project after reconnection", async () => {
  let resolveSettings!: (settings: Partial<UserSettings>) => void;
  h.getSettings.mockReturnValue(
    new Promise((resolve) => {
      resolveSettings = resolve;
    }),
  );
  render(panel());
  await screen.findByText("Loading Neon project information...");
  expect(h.getProject).not.toHaveBeenCalled();

  await act(async () => resolveSettings({}));
  await screen.findByTestId("neon-reconnection-notice");
  await act(async () => {
    client.setQueryData(queryKeys.settings.user, {
      neon: { accessToken: { value: "fresh-token" } },
    });
  });

  await screen.findByText("Demo database");
  expect(screen.getByText("dev-branch")).toBeDefined();
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
  expect(h.getProject).toHaveBeenCalledExactlyOnceWith({ appId: 1 });
  // The panel only shows the linked project, so it loads nothing else.
  expect(h.listProjects).not.toHaveBeenCalled();
  expect(h.getEmailPasswordConfig).not.toHaveBeenCalled();
  expect(h.showError).not.toHaveBeenCalled();
});

it("handles credentials rejected during a request without an error toast", async () => {
  let rejectProject!: (error: Error) => void;
  h.getProject.mockReturnValue(
    new Promise((_, reject) => {
      rejectProject = reject;
    }),
  );
  render(panel());
  await waitFor(() => expect(h.getProject).toHaveBeenCalledOnce());
  await act(async () => {
    rejectProject(
      new DyadError(NEON_RECONNECT_REQUIRED_MESSAGE, DyadErrorKind.Auth),
    );
  });
  await act(async () => {
    client.setQueryData(queryKeys.settings.user, {
      neon: { accessToken: { value: "old-token" }, reconnectRequired: true },
    });
  });
  await screen.findByTestId("neon-reconnection-notice");
  await refocus();

  expect(h.getProject).toHaveBeenCalledOnce();
  expect(h.showError).not.toHaveBeenCalled();
  expect(screen.queryByText(/Error loading Neon project:/)).toBeNull();
});

it.each([
  [
    DyadErrorKind.Auth,
    NEON_PROJECT_ACCESS_DENIED_MESSAGE,
    "projectAccessRequired",
  ],
  [DyadErrorKind.NotFound, NEON_PROJECT_NOT_FOUND_MESSAGE, "projectNotFound"],
])(
  "shows recovery guidance for a %s project without toasts",
  async (kind, message, copy) => {
    h.getProject.mockRejectedValue(new DyadError(message, kind));
    render(panel());
    await screen.findByText(`integrations.neon.${copy}`);
    expect(
      screen.getByRole("button", { name: "Reconnect Neon" }),
    ).toBeDefined();
    await refocus();
    expect(h.showError).not.toHaveBeenCalled();
  },
);

it("keeps unexpected project failures visible inline", async () => {
  h.getProject.mockRejectedValue(new Error("Neon is unavailable"));
  render(panel());
  await screen.findByText("Error loading Neon project: Neon is unavailable");
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
});
