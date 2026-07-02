import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  createChat: vi.fn(),
  isAnyProviderSetup: false,
  isLoadingLanguageModelProviders: true,
  openPreviewIfSetupRequired: vi.fn(),
  posthogCapture: vi.fn(),
  refreshApps: vi.fn(),
  setAtom: vi.fn(),
  streamMessage: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: () => ["Build a notes app", vi.fn()],
  useSetAtom: () => mocks.setAtom,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    capture: mocks.posthogCapture,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isLoading: mocks.isLoadingLanguageModelProviders,
    isAnyProviderSetup: () => mocks.isAnyProviderSetup,
  }),
}));

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({
    refreshApps: mocks.refreshApps,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    envVars: {},
    settings: {
      isTestMode: true,
      selectedChatMode: "build",
    },
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/hooks/useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({
    isLoading: false,
    isQuotaExceeded: false,
  }),
}));

vi.mock("@/hooks/useInitialChatMode", () => ({
  useInitialChatMode: () => "build",
}));

vi.mock("@/hooks/useOpenPreviewIfSetupRequired", () => ({
  useOpenPreviewIfSetupRequired: () => mocks.openPreviewIfSetupRequired,
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: mocks.streamMessage,
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({
    selectChat: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  invalidateAppQuery: vi.fn(),
}));

vi.mock("@/lib/schemas", () => ({
  getEffectiveDefaultChatMode: () => "build",
}));

vi.mock("@/client_logic/template_hook", () => ({
  neonTemplateHook: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      createApp: mocks.createApp,
    },
    chat: {
      createChat: mocks.createChat,
    },
    template: {
      setAppTheme: vi.fn(),
    },
  },
}));

vi.mock("@/components/chat/HomeChatInput", () => ({
  HomeChatInput: ({
    onSubmit,
  }: {
    onSubmit: () => boolean | Promise<boolean>;
  }) => (
    <button type="button" onClick={() => void onSubmit()}>
      Submit home prompt
    </button>
  ),
}));

vi.mock("@/components/SetupBanner", () => ({
  SetupBanner: () => <div>AI setup dialog</div>,
}));

vi.mock("@/components/TelemetryBanner", () => ({
  PrivacyBanner: () => null,
}));

vi.mock("@/components/ImportAppButton", () => ({
  ImportAppButton: () => null,
}));

vi.mock("@/components/FeaturedAppShowcase", () => ({
  FeaturedAppShowcase: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

describe("HomePage", () => {
  beforeEach(() => {
    mocks.createApp.mockReset();
    mocks.createChat.mockReset();
    mocks.posthogCapture.mockReset();
    mocks.openPreviewIfSetupRequired.mockReset();
    mocks.openPreviewIfSetupRequired.mockResolvedValue(false);
    mocks.refreshApps.mockReset();
    mocks.setAtom.mockReset();
    mocks.streamMessage.mockReset();
    mocks.updateSettings.mockReset();
    mocks.createApp.mockResolvedValue({
      app: {
        id: 1,
        name: "Test App",
      },
      chatId: 2,
    });
    mocks.isAnyProviderSetup = false;
    mocks.isLoadingLanguageModelProviders = true;
  });

  it("blocks submit while provider setup is loading and opens setup once no provider is confirmed", async () => {
    const { rerender } = renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(screen.queryByText("AI setup dialog")).toBeNull();

    mocks.isLoadingLanguageModelProviders = false;
    rerenderHomePage(rerender);

    await waitFor(() => {
      expect(screen.getByText("AI setup dialog")).toBeTruthy();
    });
    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "home:ai-setup-dialog-open",
    );
  });

  it("submits while provider data is loading when a provider is already configured", async () => {
    mocks.isAnyProviderSetup = true;

    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("AI setup dialog")).toBeNull();
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 1,
        chatId: 2,
        prompt: "Build a notes app",
      }),
    );
    expect(mocks.openPreviewIfSetupRequired).toHaveBeenCalledWith(1);
    await waitFor(() => {
      expect(mocks.setAtom).toHaveBeenCalledWith(false);
    });
  });

  it("keeps the preview panel open when setup was opened for the new app", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.openPreviewIfSetupRequired.mockResolvedValue(true);

    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    await waitFor(() => {
      expect(mocks.openPreviewIfSetupRequired).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalled();
    });
    expect(mocks.setAtom).not.toHaveBeenCalledWith(false);
  });
});

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderHomePage() {
  return render(<HomePage />, { wrapper: Wrapper });
}

function rerenderHomePage(rerender: ReturnType<typeof render>["rerender"]) {
  rerender(<HomePage />);
}
