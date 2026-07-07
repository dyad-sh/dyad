import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  createChat: vi.fn(),
  attachments: [] as any[],
  isAnyProviderSetup: false,
  isLoadingLanguageModelProviders: true,
  isSettingsLoading: false,
  effectiveDefaultChatMode: "build",
  hasManuallySelectedChatMode: false,
  inputValue: "Build a notes app",
  initialChatMode: "build",
  navigate: vi.fn(),
  openPreviewIfSetupRequired: vi.fn(),
  posthogCapture: vi.fn(),
  refreshApps: vi.fn(),
  selectedApp: null,
  setHomeSelectedApp: vi.fn(),
  setAtom: vi.fn(),
  setAttachments: vi.fn(),
  setInputValue: vi.fn(),
  setShouldResumeFirstPrompt: vi.fn(),
  shouldResumeFirstPrompt: false,
  streamMessage: vi.fn(),
  settings: {
    isTestMode: true,
    selectedChatMode: "build",
  } as any,
  updateSettings: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: (atom: { debugLabel?: string }) => {
    if (atom.debugLabel === "homeSelectedAppAtom") {
      return [mocks.selectedApp, mocks.setHomeSelectedApp];
    }
    if (atom.debugLabel === "attachmentsAtom") {
      return [mocks.attachments, mocks.setAttachments];
    }
    return [mocks.inputValue, mocks.setInputValue];
  },
  useAtomValue: (atom: { debugLabel?: string }) => {
    if (atom.debugLabel === "pendingFirstPromptAtom") {
      return mocks.shouldResumeFirstPrompt;
    }
    if (atom.debugLabel === "hasManuallySelectedChatModeAtom") {
      return mocks.hasManuallySelectedChatMode;
    }
    return undefined;
  },
  useSetAtom: (atom: { debugLabel?: string }) => {
    if (atom.debugLabel === "pendingFirstPromptAtom") {
      return mocks.setShouldResumeFirstPrompt;
    }
    return mocks.setAtom;
  },
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
  useNavigate: () => mocks.navigate,
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
    loading: mocks.isSettingsLoading,
    settings: mocks.settings,
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
  useInitialChatMode: () => mocks.initialChatMode,
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
  getEffectiveDefaultChatMode: () => mocks.effectiveDefaultChatMode,
  hasDyadProKey: (settings: any) =>
    Boolean(settings?.providerSettings?.auto?.apiKey?.value),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
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
    onSubmit: (options?: any) => boolean | Promise<boolean>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void onSubmit({
          attachments: mocks.attachments,
          selectedApp: mocks.selectedApp ?? undefined,
        })
      }
    >
      Submit home prompt
    </button>
  ),
}));

vi.mock("@/components/SetupBanner", () => ({
  SetupBanner: ({ forceShow }: { forceShow?: boolean }) =>
    forceShow ? <div>AI setup dialog</div> : null,
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
    mocks.attachments = [];
    mocks.createApp.mockReset();
    mocks.createChat.mockReset();
    mocks.effectiveDefaultChatMode = "build";
    mocks.hasManuallySelectedChatMode = false;
    mocks.inputValue = "Build a notes app";
    mocks.initialChatMode = "build";
    mocks.isSettingsLoading = false;
    mocks.navigate.mockReset();
    mocks.posthogCapture.mockReset();
    mocks.openPreviewIfSetupRequired.mockReset();
    mocks.openPreviewIfSetupRequired.mockResolvedValue(false);
    mocks.refreshApps.mockReset();
    mocks.selectedApp = null;
    mocks.setHomeSelectedApp.mockReset();
    mocks.setAtom.mockReset();
    mocks.setAttachments.mockReset();
    mocks.setInputValue.mockReset();
    mocks.setShouldResumeFirstPrompt.mockReset();
    mocks.streamMessage.mockReset();
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "build",
    };
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
    mocks.shouldResumeFirstPrompt = false;
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
    expect(mocks.setShouldResumeFirstPrompt).toHaveBeenCalledWith(true);
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

  it("shows the setup pill for non-Pro users without a configured provider", () => {
    mocks.isAnyProviderSetup = false;
    mocks.isLoadingLanguageModelProviders = false;

    renderHomePage();

    expect(
      screen.getByRole("button", { name: /Connect AI to build/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("hides the setup pill while settings or providers are loading", () => {
    mocks.isAnyProviderSetup = false;
    mocks.isLoadingLanguageModelProviders = true;

    const { rerender } = renderHomePage();

    expect(
      screen.queryByRole("button", { name: /Connect AI to build/ }),
    ).toBeNull();

    mocks.isLoadingLanguageModelProviders = false;
    mocks.isSettingsLoading = true;
    rerenderHomePage(rerender);

    expect(
      screen.queryByRole("button", { name: /Connect AI to build/ }),
    ).toBeNull();
  });

  it("de-emphasizes the setup pill when an AI provider is configured", () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;

    renderHomePage();

    expect(
      screen.getByRole("button", { name: "Manage AI setup" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Connect AI to build/ }),
    ).toBeNull();
  });

  it("opens the setup dialog from the configured-provider manage link", () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;

    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: "Manage AI setup" }));

    expect(screen.getByText("AI setup dialog")).toBeTruthy();
  });

  it("hides the setup pill when a Dyad Pro API key is saved", () => {
    mocks.settings = {
      enableDyadPro: false,
      isTestMode: true,
      providerSettings: {
        auto: {
          apiKey: {
            value: "dyad-pro-key",
          },
        },
      },
      selectedChatMode: "build",
    };

    renderHomePage();

    expect(
      screen.queryByRole("button", { name: /Connect AI to build/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Manage AI setup" }),
    ).toBeNull();
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

  it("auto-submits a pending first prompt once provider setup is ready", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.shouldResumeFirstPrompt = true;

    renderHomePage();

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledTimes(1);
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/",
      search: {},
      replace: true,
    });
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 1,
        chatId: 2,
        prompt: "Build a notes app",
      }),
    );
    await waitFor(() => {
      expect(mocks.setShouldResumeFirstPrompt).toHaveBeenCalledWith(false);
    });
  });

  it("auto-submits a pending first prompt with the effective home default before settings catch up", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.shouldResumeFirstPrompt = true;
    mocks.initialChatMode = "build";
    mocks.effectiveDefaultChatMode = "local-agent";
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "build",
    };

    renderHomePage();

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      selectedChatMode: "local-agent",
    });
    expect(mocks.createApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialChatMode: "local-agent",
      }),
    );
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedChatMode: "local-agent",
      }),
    );
  });

  it("syncs selected chat mode when provider setup changes the effective home default", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.initialChatMode = "build";
    mocks.effectiveDefaultChatMode = "build";
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "build",
    };

    const { rerender } = renderHomePage();

    expect(mocks.updateSettings).not.toHaveBeenCalled();

    mocks.effectiveDefaultChatMode = "local-agent";
    mocks.settings = { ...mocks.settings };
    rerenderHomePage(rerender);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedChatMode: "local-agent",
      });
    });
  });

  it("uses the Free Pro fallback when the effective home default resolves to build", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.initialChatMode = "build";
    mocks.effectiveDefaultChatMode = "build";
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "build",
      selectedModel: {
        provider: "auto",
        name: "free-pro",
      },
    };

    renderHomePage();

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedChatMode: "local-agent",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledWith(
        expect.objectContaining({
          initialChatMode: "local-agent",
        }),
      );
    });
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedChatMode: "local-agent",
      }),
    );
    expect(mocks.updateSettings).not.toHaveBeenCalledWith({
      selectedChatMode: "build",
    });
  });

  it("does not override a manually selected chat mode when the effective home default changes", () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.initialChatMode = "build";
    mocks.effectiveDefaultChatMode = "build";
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "build",
    };

    const { rerender } = renderHomePage();

    mocks.updateSettings.mockClear();

    // User explicitly picks a mode from the selector, which latches the flag.
    mocks.hasManuallySelectedChatMode = true;
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "ask",
    };
    mocks.effectiveDefaultChatMode = "local-agent";
    rerenderHomePage(rerender);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("submits with the manually selected chat mode instead of the effective default", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    // Effective default differs from what the user actually picked.
    mocks.initialChatMode = "build";
    mocks.effectiveDefaultChatMode = "local-agent";
    // User latched a manual "plan" selection via the selector.
    mocks.hasManuallySelectedChatMode = true;
    mocks.settings = {
      isTestMode: true,
      selectedChatMode: "plan",
    };

    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledWith(
        expect.objectContaining({
          initialChatMode: "plan",
        }),
      );
    });
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedChatMode: "plan",
      }),
    );
    // The latched manual selection must not be overwritten by the sync effect.
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("auto-submits an attachment-only pending first prompt once provider setup is ready", async () => {
    const attachment = {
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      type: "chat-context",
    };
    mocks.attachments = [attachment];
    mocks.inputValue = "";
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.shouldResumeFirstPrompt = true;

    renderHomePage();

    await waitFor(() => {
      expect(mocks.createApp).toHaveBeenCalledTimes(1);
    });
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 1,
        attachments: [attachment],
        chatId: 2,
        prompt: "",
      }),
    );
    await waitFor(() => {
      expect(mocks.setShouldResumeFirstPrompt).toHaveBeenCalledWith(false);
    });
    expect(mocks.setAttachments).toHaveBeenCalledWith([]);
  });

  it("clears the pending first prompt flag when auto-resume fails", async () => {
    mocks.isAnyProviderSetup = true;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.shouldResumeFirstPrompt = true;
    mocks.createApp.mockRejectedValue(new Error("create failed"));

    renderHomePage();

    await waitFor(() => {
      expect(mocks.setShouldResumeFirstPrompt).toHaveBeenCalledWith(false);
    });
    expect(mocks.streamMessage).not.toHaveBeenCalled();
    expect(mocks.setAttachments).not.toHaveBeenCalled();
    expect(mocks.setHomeSelectedApp).not.toHaveBeenCalled();
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
