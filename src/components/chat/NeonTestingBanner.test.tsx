import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import en from "@/i18n/locales/en/chat.json";
import { NeonTestingBanner } from "./NeonTestingBanner";

type TestApp = Pick<
  App,
  "id" | "neonProjectId" | "supabaseProjectId" | "testingEnabled"
>;
const mocks = vi.hoisted(() => ({
  getApp: vi.fn(),
  setTestingEnabled: vi.fn(),
  showError: vi.fn(),
  settings: {} as Partial<UserSettings> | null,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { getApp: mocks.getApp, setTestingEnabled: mocks.setTestingEnabled },
  },
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      en.neonTestingBanner[
        key.split(".")[1] as keyof typeof en.neonTestingBanner
      ] ?? key,
  }),
}));

function neonApp(id = 7): TestApp {
  return {
    id,
    neonProjectId: `neon-${id}`,
    supabaseProjectId: null,
    testingEnabled: false,
  };
}

function renderBanner(appId: number | null = 7) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onEnabled = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return {
    ...render(<NeonTestingBanner appId={appId} onEnabled={onEnabled} />, {
      wrapper,
    }),
    onEnabled,
  };
}

const banner = () => screen.queryByTestId("neon-testing-banner");
const enableButton = () =>
  screen.getByRole("button", { name: "Enable testing" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.settings = {};
  mocks.getApp.mockImplementation(async (id: number) => neonApp(id));
  mocks.setTestingEnabled.mockImplementation(async ({ appId }) => {
    mocks.getApp.mockImplementation(async (id: number) => ({
      ...neonApp(id),
      testingEnabled: id === appId,
    }));
    return { testingEnabled: true };
  });
});

describe("NeonTestingBanner", () => {
  it("offers isolated testing and enables only the selected app on click", async () => {
    const { onEnabled } = renderBanner();
    await screen.findByText(en.neonTestingBanner.message);
    expect(mocks.setTestingEnabled).not.toHaveBeenCalled();

    fireEvent.click(enableButton());

    await waitFor(() => expect(onEnabled).toHaveBeenCalledTimes(1));
    expect(mocks.setTestingEnabled).toHaveBeenCalledExactlyOnceWith({
      appId: 7,
      enabled: true,
    });
    await waitFor(() => expect(banner()).toBeNull());
  });

  it("stays hidden without a selected app", () => {
    renderBanner(null);
    expect(banner()).toBeNull();
    expect(mocks.getApp).not.toHaveBeenCalled();
  });

  it.each([
    ["app unavailable", null, {}],
    ["no database", { ...neonApp(), neonProjectId: null }, {}],
    ["already enabled", { ...neonApp(), testingEnabled: true }, {}],
    [
      "Supabase takes precedence",
      { ...neonApp(), supabaseProjectId: "sb" },
      {},
    ],
    ["settings unavailable", neonApp(), null],
    ["Docker runtime", neonApp(), { runtimeMode2: "docker" }],
    ["cloud runtime", neonApp(), { runtimeMode2: "cloud" }],
    ["sandbox disabled", neonApp(), { disableSandboxedE2eTests: true }],
  ] as const)("stays hidden when %s", async (_name, app, settings) => {
    mocks.getApp.mockResolvedValue(app);
    mocks.settings = settings;
    renderBanner();
    await act(async () => {});
    expect(banner()).toBeNull();
    expect(mocks.setTestingEnabled).not.toHaveBeenCalled();
  });

  it("waits for app data before showing the offer", async () => {
    let resolveApp!: (app: TestApp) => void;
    mocks.getApp.mockReturnValue(
      new Promise<TestApp>((resolve) => {
        resolveApp = resolve;
      }),
    );
    renderBanner();
    expect(banner()).toBeNull();
    await act(async () => resolveApp(neonApp()));
    await screen.findByText(en.neonTestingBanner.message);
  });

  it("remembers dismissal across remounts without dismissing other apps", async () => {
    const { rerender, onEnabled, unmount } = renderBanner();
    await screen.findByText(en.neonTestingBanner.message);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss testing suggestion" }),
    );
    expect(banner()).toBeNull();
    expect(mocks.setTestingEnabled).not.toHaveBeenCalled();

    rerender(<NeonTestingBanner appId={8} onEnabled={onEnabled} />);
    await screen.findByText(en.neonTestingBanner.message);
    rerender(<NeonTestingBanner appId={7} onEnabled={onEnabled} />);
    expect(banner()).toBeNull();
    unmount();

    // A fresh renderer store reads the persisted dismissal.
    renderBanner();
    await act(async () => {});
    expect(banner()).toBeNull();
  });

  it("blocks repeat clicks and uses the latest navigation callback on success", async () => {
    let resolveEnable!: (result: { testingEnabled: boolean }) => void;
    mocks.setTestingEnabled.mockReturnValue(
      new Promise<{ testingEnabled: boolean }>((resolve) => {
        resolveEnable = resolve;
      }),
    );
    const { rerender, onEnabled } = renderBanner();
    await screen.findByText(en.neonTestingBanner.message);
    fireEvent.click(enableButton());
    const pending = await screen.findByRole("button", { name: "Enabling…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(mocks.setTestingEnabled).toHaveBeenCalledTimes(1);

    const latestOnEnabled = vi.fn();
    rerender(<NeonTestingBanner appId={7} onEnabled={latestOnEnabled} />);
    await act(async () => resolveEnable({ testingEnabled: true }));
    await waitFor(() => expect(latestOnEnabled).toHaveBeenCalledTimes(1));
    expect(onEnabled).not.toHaveBeenCalled();
  });

  it("does not open Tests for another app when an earlier enable finishes", async () => {
    let resolveEnable!: (result: { testingEnabled: boolean }) => void;
    mocks.setTestingEnabled.mockReturnValue(
      new Promise<{ testingEnabled: boolean }>((resolve) => {
        resolveEnable = resolve;
      }),
    );
    const { rerender, onEnabled } = renderBanner();
    await screen.findByText(en.neonTestingBanner.message);
    fireEvent.click(enableButton());
    await screen.findByRole("button", { name: "Enabling…" });

    rerender(<NeonTestingBanner appId={8} onEnabled={onEnabled} />);
    await screen.findByText(en.neonTestingBanner.message);
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolveEnable({ testingEnabled: true }));
    expect(onEnabled).not.toHaveBeenCalled();
    expect(banner()).not.toBeNull();
  });

  it("reports errors and keeps the offer available for retry", async () => {
    mocks.setTestingEnabled.mockRejectedValueOnce(new Error("Save failed"));
    const { onEnabled } = renderBanner();
    await screen.findByText(en.neonTestingBanner.message);
    fireEvent.click(enableButton());

    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith("Save failed"),
    );
    expect(onEnabled).not.toHaveBeenCalled();
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enableButton());
    await waitFor(() => expect(onEnabled).toHaveBeenCalledTimes(1));
  });
});
