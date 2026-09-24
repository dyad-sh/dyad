import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
vi.mock("./SubscriptionModelMenu", () => ({
  SubscriptionModelMenu: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/hooks/useSubscriptionAccount", () => ({
  useSubscriptionAccount: () => ({
    isLoading: mocks.subscriptionLoading,
    data: mocks.subscriptionUnavailable
      ? undefined
      : {
          connected: mocks.subscriptionConnected,
          models: ["gpt-5"],
          windows: [],
          limitReached: false,
        },
  }),
}));

const mocks = vi.hoisted(() => ({
  subscriptionUnavailable: false,
  subscriptionLoading: false,
  subscriptionConnected: true,
  invalidateQueries: vi.fn(),
  anthropicModels: [] as import("@/ipc/types").LanguageModel[],
  claudeModels: [{ value: "sonnet", displayName: "sonnet", description: "" }] as
    | Array<{
        value: string;
        resolvedModel?: string;
        displayName: string;
        description: string;
      }>
    | undefined,
  claudeModelsError: false,
  refetchClaudeModels: vi.fn(),
  refetchClaudeStatus: vi.fn(),
  forceStatus: vi.fn().mockResolvedValue({ connected: true }),
  claudeStatus: {
    installed: true,
    connected: true,
    compatible: true,
    version: "2.1.260",
    detail: "Connected",
  },
  createChat: vi.fn(async () => 55),
  selectChat: vi.fn(),
  setChatMode: vi.fn(),
  setChatModelSelection: vi.fn(),
  setChatSelection: vi.fn(),
  updateSettings: vi.fn(),
  updateChat: vi.fn(),
  navigate: vi.fn(),
  posthogCapture: vi.fn(),
  openExternalUrl: vi.fn(),
  loadOllamaModels: vi.fn(),
  loadLMStudioModels: vi.fn(),
  dropdownOpenChange: null as null | ((open: boolean) => void),
  preventBaseUIHandler: vi.fn(),
  selectedMode: "build",
  isTrial: false,
  renderSubContent: false,
  catalogLoading: false,
  catalogUnavailable: false,
  catalogError: null as Error | null,
  settingsAvailable: true,
  settingsLoading: false,
  chatLoading: false,
  chat: null as null | {
    id: number;
    appId?: number;
    executionBackend?: "dyad" | "claude-code";
    messages: Array<{ id: number }>;
    modelSelection?: {
      provider: string;
      name: string;
      effortLevel: string;
    };
  },
  pathname: "/",
  search: {} as { id?: number },
  envVars: {} as Record<string, string | undefined>,
  ollamaModels: [] as Array<{
    provider: "ollama";
    modelName: string;
    displayName: string;
  }>,
  ollamaError: null as Error | null,
  lmStudioModels: [] as Array<{
    provider: "lmstudio";
    modelName: string;
    displayName: string;
  }>,
  lmStudioError: null as Error | null,
  freeModelQuota: {
    quotaStatus: {
      messagesUsed: 3,
      messagesLimit: 5,
      messagesRemaining: 2,
      isQuotaExceeded: false,
      resetTime: new Date("2026-06-26T00:00:00Z").getTime(),
    } as {
      messagesUsed: number;
      messagesLimit: number;
      messagesRemaining: number;
      isQuotaExceeded: boolean;
      resetTime: number;
    } | null,
    isLoading: false,
    error: null as Error | null,
    isQuotaExceeded: false,
    messagesUsed: 3,
    messagesLimit: 5,
    messagesRemaining: 2,
    resetTime: new Date("2026-06-26T00:00:00Z").getTime(),
  },
  settings: {
    proModelUsage: "subscription" as "subscription" | "pro" | "api-key",
    enableDyadPro: true,
    providerSettings: {
      auto: {
        apiKey: {
          value: "dyad-pro-key",
        },
      },
      openrouter: {
        apiKey: {
          value: "",
        },
      },
    },
    selectedModel: {
      name: "auto",
      provider: "auto",
    } as { name: string; provider: string; customModelId?: number },
    recentModels: [] as
      | Array<{
          name: string;
          provider: string;
          customModelId?: number;
        }>
      | undefined,
    selectedChatMode: "build",
    defaultChatMode: "build",
  },
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: mocks.selectChat }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey.includes("claudeCodeStatus") ||
      queryKey.includes("claude-code-status")
        ? mocks.claudeStatus
        : queryKey.includes("claudeCodeModels")
          ? mocks.claudeModels
          : undefined,
    isError: queryKey.includes("claudeCodeModels") && mocks.claudeModelsError,
    isPending:
      queryKey.includes("claudeCodeModels") &&
      !mocks.claudeModels &&
      !mocks.claudeModelsError,
    refetch: queryKey.includes("claudeCodeModels")
      ? mocks.refetchClaudeModels
      : mocks.refetchClaudeStatus,
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value?: unknown) => Promise<unknown>;
  }) => {
    const [error, setError] = useState<Error | null>(null);
    return {
      mutate: (value?: unknown) => {
        void Promise.resolve(mutationFn(value)).catch(setError);
      },
      reset: () => setError(null),
      isPending: false,
      error,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    fetchQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settingsAvailable ? mocks.settings : null,
    updateSettings: mocks.updateSettings,
    envVars: mocks.envVars,
    loading: mocks.settingsLoading,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({
    location: {
      pathname: mocks.pathname,
      search: mocks.search,
    },
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    capture: mocks.posthogCapture,
  }),
}));

vi.mock("@/routes/settings/providers/$provider", () => ({
  providerSettingsRoute: {
    id: "/settings/providers/$provider",
  },
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ipc: {
    chat: {
      claudeCodeStatus: mocks.forceStatus,
      createChat: mocks.createChat,
      updateChat: mocks.updateChat,
    },
    system: {
      openExternalUrl: mocks.openExternalUrl,
    },
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: () => ({
    chat: mocks.chat,
    isLoading: mocks.chatLoading,
    selectedMode: mocks.selectedMode,
    setChatMode: mocks.setChatMode,
    setChatModelSelection: mocks.setChatModelSelection,
    setChatSelection: mocks.setChatSelection,
  }),
}));

vi.mock("@/hooks/useTrialModelRestriction", () => ({
  useTrialModelRestriction: () => ({
    isTrial: mocks.isTrial,
    isLoadingTrialStatus: false,
  }),
}));

vi.mock("@/hooks/useFreeModelQuota", () => ({
  useFreeModelQuota: () => mocks.freeModelQuota,
}));

vi.mock("@/hooks/useLanguageModelsByProviders", () => ({
  useLanguageModelsByProviders: () => ({
    isLoading: mocks.catalogLoading,
    error: mocks.catalogError,
    data: mocks.catalogUnavailable
      ? undefined
      : {
          anthropic: mocks.anthropicModels,
          auto: [
            {
              apiName: "auto",
              displayName: "Auto",
              description: "Automatically selects a model",
              type: "cloud",
            },
            {
              apiName: "balanced",
              displayName: "Auto (balanced)",
              description: "Balanced model",
              type: "cloud",
            },
            {
              apiName: "free",
              displayName: "Free (OpenRouter)",
              description: "Free model",
              type: "cloud",
            },
            {
              apiName: "free-pro",
              displayName: "Dyad Free",
              description: "Free Pro model",
              type: "cloud",
              tag: "Free",
            },
          ],
          openai: [
            {
              apiName: "gpt-5-mini",
              displayName: "GPT 5 Mini",
              description: "OpenAI smaller model",
              dollarSigns: 2,
              type: "cloud",
            },
            {
              apiName: "gpt-5",
              displayName: "GPT 5",
              description: "OpenAI model",
              dollarSigns: 3,
              effortSettings: {
                defaultEffortLevel: "minimal",
                possibleEffortLevels: ["minimal", "xhigh"],
              },
              type: "cloud",
            },
          ],
          google: [
            {
              apiName: "gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              description: "Google model",
              dollarSigns: 2,
              type: "cloud",
            },
            {
              apiName: "gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              description: "Google flash model",
              dollarSigns: 2,
              type: "cloud",
            },
          ],
          vertex: [
            {
              apiName: "gemini-2.5-pro",
              displayName: "Vertex Gemini 2.5 Pro",
              description: "Vertex model with price metadata",
              dollarSigns: 3,
              type: "cloud",
            },
          ],
          openrouter: [
            {
              apiName: "openrouter/free",
              displayName: "Free (OpenRouter)",
              description: "Free OpenRouter model",
              type: "cloud",
            },
            {
              apiName: "anthropic/claude-sonnet-4.5",
              displayName: "Claude Sonnet 4.5",
              description: "OpenRouter paid model",
              dollarSigns: 2,
              type: "cloud",
            },
          ],
          xai: [
            {
              apiName: "grok-code-fast-1",
              displayName: "Grok Code Fast",
              description: "xAI model",
              type: "cloud",
            },
          ],
          custom: [
            {
              id: 1,
              apiName: "shared-model",
              displayName: "Custom A",
              type: "custom",
            },
            {
              id: 2,
              apiName: "shared-model",
              displayName: "Custom B",
              type: "custom",
            },
            {
              id: 3,
              apiName: "team/free",
              displayName: "Custom Free",
              type: "custom",
            },
          ],
        },
  }),
}));

vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isLoading: false,
    isProviderSetup: (provider: string) => {
      if (provider === "openrouter") {
        return Boolean(
          mocks.settings.providerSettings.openrouter.apiKey.value ||
          mocks.envVars.OPENROUTER_API_KEY,
        );
      }
      return false;
    },
    data: [
      {
        id: "auto",
        name: "Dyad",
        type: "cloud",
      },
      {
        id: "openai",
        name: "OpenAI",
        type: "cloud",
      },
      {
        id: "google",
        name: "Google",
        type: "cloud",
      },
      {
        id: "vertex",
        name: "Google Vertex AI",
        type: "cloud",
        secondary: true,
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        type: "cloud",
      },
      {
        id: "xai",
        name: "xAI",
        type: "cloud",
        secondary: true,
      },
      {
        id: "custom",
        name: "Custom Provider",
        type: "custom",
      },
    ],
  }),
}));

vi.mock("@/hooks/useLocalModels", () => ({
  useLocalModels: () => ({
    models: mocks.ollamaModels,
    loading: false,
    error: mocks.ollamaError,
    loadModels: mocks.loadOllamaModels,
  }),
}));

vi.mock("@/hooks/useLMStudioModels", () => ({
  useLocalLMSModels: () => ({
    models: mocks.lmStudioModels,
    loading: false,
    error: mocks.lmStudioError,
    loadModels: mocks.loadLMStudioModels,
  }),
}));

vi.mock("@/components/PriceBadge", () => ({
  PriceBadge: () => <span data-testid="price-badge" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    render,
    ...props
  }: React.ComponentProps<"button"> & { render?: React.ReactElement }) =>
    render ?? <button {...props} />,
  TooltipContent: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/dropdown-menu")>()),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
  }: {
    children: React.ReactNode;
    checked: boolean;
    onCheckedChange(checked: boolean): void;
  }) => (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    >
      {children}
    </button>
  ),
  DropdownMenu: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    mocks.dropdownOpenChange = onOpenChange ?? null;
    return <div>{children}</div>;
  },
  DropdownMenuTrigger: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
  DropdownMenuContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="model-picker-dropdown">
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    closeOnClick: _closeOnClick,
    ...props
  }: {
    children: React.ReactNode;
    closeOnClick?: boolean;
  }) => <button {...props}>{children}</button>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr data-slot="dropdown-menu-separator" />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({
    children,
    hideChevron: _hideChevron,
    openOnHover,
    delay,
    closeDelay,
    onMouseDown,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    hideChevron?: boolean;
    openOnHover?: boolean;
    delay?: number;
    closeDelay?: number;
    onMouseDown?: (
      event: React.MouseEvent<HTMLButtonElement> & {
        preventBaseUIHandler: () => void;
      },
    ) => void;
    onClick?: (
      event: React.MouseEvent<HTMLButtonElement> & {
        preventBaseUIHandler: () => void;
      },
    ) => void;
  }) => (
    <button
      {...props}
      data-open-on-hover={openOnHover || undefined}
      data-hover-delay={delay}
      data-close-delay={closeDelay}
      onMouseDown={(event) =>
        onMouseDown?.(
          Object.assign(event, {
            preventBaseUIHandler: mocks.preventBaseUIHandler,
          }),
        )
      }
      onClick={(event) =>
        onClick?.(
          Object.assign(event, {
            preventBaseUIHandler: mocks.preventBaseUIHandler,
          }),
        )
      }
    >
      {children}
    </button>
  ),
  DropdownMenuSubContent: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  }) => (mocks.renderSubContent ? <div {...props}>{children}</div> : null),
}));

describe("ModelPicker", () => {
  beforeEach(() => {
    mocks.subscriptionUnavailable = false;
    mocks.subscriptionLoading = false;
    mocks.subscriptionConnected = true;
    mocks.settings.proModelUsage = "subscription";
    mocks.invalidateQueries.mockReset();
    mocks.setChatMode.mockReset();
    mocks.setChatMode.mockResolvedValue(undefined);
    mocks.setChatModelSelection.mockReset();
    mocks.setChatModelSelection.mockResolvedValue(undefined);
    mocks.setChatSelection.mockReset();
    mocks.setChatSelection.mockResolvedValue(undefined);
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(mocks.settings);
    mocks.updateChat.mockReset();
    mocks.updateChat.mockResolvedValue(undefined);
    mocks.navigate.mockReset();
    mocks.posthogCapture.mockReset();
    mocks.openExternalUrl.mockReset();
    mocks.loadOllamaModels.mockReset();
    mocks.loadOllamaModels.mockResolvedValue(undefined);
    mocks.loadLMStudioModels.mockReset();
    mocks.loadLMStudioModels.mockResolvedValue(undefined);
    mocks.dropdownOpenChange = null;
    mocks.preventBaseUIHandler.mockReset();
    mocks.selectedMode = "build";
    mocks.renderSubContent = false;
    mocks.catalogLoading = false;
    mocks.catalogUnavailable = false;
    mocks.catalogError = null;
    mocks.settingsAvailable = true;
    mocks.settingsLoading = false;
    mocks.chatLoading = false;
    mocks.chat = null;
    mocks.claudeStatus.connected = true;
    mocks.claudeStatus.compatible = true;
    mocks.claudeModels = [
      { value: "sonnet", displayName: "sonnet", description: "" },
    ];
    mocks.claudeModelsError = false;
    mocks.refetchClaudeModels.mockClear();
    mocks.refetchClaudeStatus.mockClear();
    mocks.createChat.mockClear();
    mocks.selectChat.mockClear();
    mocks.pathname = "/";
    mocks.search = {};
    mocks.envVars = {};
    mocks.ollamaModels = [];
    mocks.ollamaError = null;
    mocks.lmStudioModels = [];
    mocks.lmStudioError = null;
    mocks.settings.enableDyadPro = true;
    mocks.settings.providerSettings.auto.apiKey.value = "dyad-pro-key";
    mocks.settings.providerSettings.openrouter.apiKey.value = "";
    mocks.settings.selectedModel = { name: "auto", provider: "auto" };
    mocks.settings.recentModels = [];
    mocks.settings.selectedChatMode = "build";
    mocks.settings.defaultChatMode = "build";
    mocks.isTrial = false;
    mocks.freeModelQuota.isQuotaExceeded = false;
    mocks.freeModelQuota.error = null;
    mocks.freeModelQuota.messagesRemaining = 2;
    mocks.freeModelQuota.quotaStatus = {
      messagesUsed: 3,
      messagesLimit: 5,
      messagesRemaining: 2,
      isQuotaExceeded: false,
      resetTime: new Date("2026-06-26T00:00:00Z").getTime(),
    };
  });

  it("keeps the root menu focused on quick choices and catalog entry points", () => {
    render(<ModelPicker />);

    const autoSidekickRow = screen.getByText("Auto Sidekick").closest("button");
    expect(autoSidekickRow?.textContent).toContain("Experimental");
    expect(autoSidekickRow?.getAttribute("aria-label")).toContain(
      "Experimental",
    );
    expect(screen.queryByText("GPT 5")).toBeNull();
    expect(screen.queryByText("Premium")).toBeNull();
    expect(screen.queryByText("Local models")).toBeNull();
    expect(screen.queryByText("Free (OpenRouter)")).toBeNull();
    expect(screen.getByText("Dyad Free")).toBeTruthy();
    expect(screen.getByText("2/5 left")).toBeTruthy();
    expect(screen.getByText("Data sharing")).toBeTruthy();
    expect(
      screen
        .getByText("Dyad Free")
        .closest("button")
        ?.getAttribute("aria-label"),
    ).toContain("2/5 left. Data sharing");
    expect(screen.getByText("All models")).toBeTruthy();
  });

  it("keeps All models stationary while the cloud catalog loads", () => {
    mocks.catalogLoading = true;
    const { rerender } = render(<ModelPicker />);
    const allModelsTrigger = screen.getByText("All models").closest("button");

    mocks.catalogLoading = false;
    rerender(<ModelPicker />);

    expect(screen.getByText("All models").closest("button")).toBe(
      allModelsTrigger,
    );
    expect(
      allModelsTrigger?.compareDocumentPosition(
        document.querySelector(
          '[data-model-provider="auto"][data-model-name="auto"]',
        )!,
      ) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps All models as the only catalog entry before quick choices", () => {
    render(<ModelPicker />);

    const allModels = screen.getByText("All models").closest("button")!;
    expect(screen.queryByText("Local models")).toBeNull();
    expect(
      allModels.parentElement?.nextElementSibling?.getAttribute("data-slot"),
    ).toBe("dropdown-menu-separator");
  });

  it("shows up to five persisted specific models in a Recent section", () => {
    mocks.settings.recentModels = [
      { provider: "openai", name: "gpt-5" },
      {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4.5",
      },
      { provider: "auto", name: "auto-sidekick" },
    ];

    render(<ModelPicker />);

    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.getAllByText("Claude Sonnet 4.5")[0]).toBeTruthy();
    const gptRow = screen.getByText("GPT 5").closest("button")!;
    expect(within(gptRow).queryByText("OpenAI")).toBeNull();
    expect(gptRow.getAttribute("aria-label")).not.toContain("OpenAI");
    expect(screen.getAllByText("Auto Sidekick")).toHaveLength(1);
  });

  it("preserves unresolved cloud history when adding a recent model", async () => {
    mocks.renderSubContent = true;
    mocks.settings.recentModels = [
      { provider: "openai", name: "deleted-model" },
      { provider: "openai", name: "gpt-5" },
      { provider: "openai", name: "gpt-5-mini" },
      { provider: "google", name: "gemini-2.5-pro" },
      { provider: "google", name: "gemini-2.5-flash" },
    ];

    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="xai"][data-model-name="grok-code-fast-1"]',
      )!,
    );

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: { provider: "xai", name: "grok-code-fast-1" },
        recentModels: [
          { provider: "xai", name: "grok-code-fast-1" },
          { provider: "openai", name: "deleted-model" },
          { provider: "openai", name: "gpt-5" },
          { provider: "openai", name: "gpt-5-mini" },
          { provider: "google", name: "gemini-2.5-pro" },
        ],
      });
    });
  });

  it("normalizes legacy custom recents without duplicating them", async () => {
    mocks.renderSubContent = true;
    mocks.settings.selectedModel = {
      provider: "custom",
      name: "shared-model",
    };
    mocks.settings.recentModels = [
      { provider: "custom", name: "shared-model" },
      { provider: "openrouter", name: "openrouter/free" },
    ];

    render(<ModelPicker />);
    const customARow = screen.getAllByLabelText(/Custom A.*Selected/)[0];
    const customBRow = screen.getAllByLabelText(/^Custom B/)[0];
    expect(customBRow.getAttribute("aria-label")).not.toContain("Selected");
    fireEvent.click(customARow);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: {
          provider: "custom",
          name: "shared-model",
          customModelId: 1,
        },
        recentModels: [
          {
            provider: "custom",
            name: "shared-model",
            customModelId: 1,
          },
          { provider: "openrouter", name: "openrouter/free" },
        ],
      });
    });
  });

  it("keeps hook order stable while settings load", () => {
    mocks.settingsAvailable = false;
    const { rerender } = render(<ModelPicker />);

    mocks.settingsAvailable = true;
    expect(() => rerender(<ModelPicker />)).not.toThrow();
    expect(screen.getByTestId("model-picker")).toBeTruthy();
  });

  it("preserves the selected-model fallback when switching to Auto", async () => {
    mocks.settings.selectedModel = { provider: "openai", name: "gpt-5" };
    mocks.settings.recentModels = undefined;

    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )!,
    );

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: { provider: "auto", name: "auto" },
        recentModels: [{ provider: "openai", name: "gpt-5" }],
      });
    });
  });

  it("uses the active chat model to seed fallback recents", async () => {
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };
    mocks.settings.selectedModel = { provider: "auto", name: "auto" };
    mocks.settings.recentModels = undefined;
    mocks.chat = {
      id: 42,
      messages: [{ id: 1 }],
      modelSelection: {
        provider: "openai",
        name: "gpt-5",
        effortLevel: "minimal",
      },
    };

    render(<ModelPicker />);
    expect(screen.getAllByText("GPT 5")).toHaveLength(2);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )!,
    );

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        recentModels: [{ provider: "openai", name: "gpt-5" }],
      });
    });
  });

  it("keeps custom model ids ending in /free visible for Pro users", () => {
    mocks.settings.recentModels = [
      { provider: "custom", name: "team/free", customModelId: 3 },
    ];
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(screen.getAllByText("Custom Free")).toHaveLength(2);
    for (const row of document.querySelectorAll(
      '[data-model-provider="custom"][data-model-name="team/free"]',
    )) {
      expect(row.getAttribute("aria-label")).not.toContain("Data sharing");
      expect(within(row as HTMLElement).queryByText("Data sharing")).toBeNull();
    }
  });

  it("filters hidden Pro models out of Recent", () => {
    mocks.settings.recentModels = [
      { provider: "openrouter", name: "openrouter/free" },
    ];

    render(<ModelPicker />);

    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.queryByText("Free (OpenRouter)")).toBeNull();
  });

  it("uses custom model ids for Recent keys and selection", () => {
    mocks.settings.selectedModel = {
      provider: "custom",
      name: "shared-model",
      customModelId: 2,
    };
    mocks.settings.recentModels = [
      { provider: "custom", name: "shared-model", customModelId: 1 },
      { provider: "custom", name: "shared-model", customModelId: 2 },
    ];

    render(<ModelPicker />);

    const recentRows = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[data-model-provider="custom"][data-model-name="shared-model"]',
      ),
    );
    expect(recentRows).toHaveLength(2);
    expect(recentRows[0].getAttribute("aria-label")).not.toContain("Selected");
    expect(recentRows[1].getAttribute("aria-label")).toContain("Selected");
  });

  it("reserves recent local model rows while local catalogs load", () => {
    mocks.settings.recentModels = [
      { provider: "ollama", name: "qwen3-coder:30b" },
    ];

    render(<ModelPicker />);

    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.getByText("qwen3-coder:30b")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("resolves recent local rows independently by provider", async () => {
    let resolveOllama: (() => void) | undefined;
    mocks.loadOllamaModels.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOllama = resolve;
        }),
    );
    mocks.loadLMStudioModels.mockImplementationOnce(
      () => new Promise<void>(() => undefined),
    );
    mocks.settings.recentModels = [
      { provider: "ollama", name: "missing-ollama" },
      { provider: "lmstudio", name: "missing-lmstudio" },
    ];

    render(<ModelPicker />);
    act(() => mocks.dropdownOpenChange?.(true));
    expect(screen.getAllByText("Loading...")).toHaveLength(2);

    await act(async () => resolveOllama?.());

    await waitFor(() => {
      expect(screen.queryByText("missing-ollama")).toBeNull();
      expect(screen.getByText("missing-lmstudio")).toBeTruthy();
      expect(screen.getAllByText("Loading...")).toHaveLength(1);
    });
  });

  it("does not show providers on pending Recent local model rows", () => {
    mocks.settings.recentModels = [
      { provider: "ollama", name: "shared-model" },
      { provider: "lmstudio", name: "shared-model" },
    ];

    render(<ModelPicker />);

    const rows = screen.getAllByLabelText("shared-model. Loading local model");
    expect(rows).toHaveLength(2);
    expect(screen.queryByText("Ollama")).toBeNull();
    expect(screen.queryByText("LM Studio")).toBeNull();
  });

  it("hides cached local recents after the provider refresh fails", () => {
    mocks.ollamaModels = [
      {
        provider: "ollama",
        modelName: "qwen3-coder:30b",
        displayName: "Qwen3 Coder 30B",
      },
    ];
    mocks.ollamaError = new Error("Ollama unavailable");
    mocks.settings.recentModels = [
      { provider: "ollama", name: "qwen3-coder:30b" },
    ];

    render(<ModelPicker />);

    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.queryByText("Qwen3 Coder 30B")).toBeNull();
  });

  it("does not show providers on ambiguous Recent local model rows", () => {
    mocks.ollamaModels = [
      {
        provider: "ollama",
        modelName: "shared-model",
        displayName: "Shared Local",
      },
    ];
    mocks.lmStudioModels = [
      {
        provider: "lmstudio",
        modelName: "shared-model",
        displayName: "Shared Local",
      },
    ];
    mocks.settings.recentModels = [
      { provider: "ollama", name: "shared-model" },
      { provider: "lmstudio", name: "shared-model" },
    ];

    render(<ModelPicker />);

    const rows = screen.getAllByLabelText(/^Shared Local\. Effort:/);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText("shared-model")).toBeTruthy();
      expect(row.getAttribute("aria-label")).not.toMatch(/Ollama|LM Studio/);
    }
  });

  it("keeps local models reachable while the cloud catalog loads", () => {
    mocks.catalogLoading = true;
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(screen.getAllByText("All models").length).toBeGreaterThan(0);
    expect(screen.getByText("Local providers")).toBeTruthy();
    expect(screen.getByText("Ollama")).toBeTruthy();
    expect(screen.getByText("LM Studio")).toBeTruthy();
    expect(screen.getByText("Loading cloud models...")).toBeTruthy();
  });

  it("shows a cloud catalog error without hiding local models", () => {
    mocks.catalogUnavailable = true;
    mocks.catalogError = new Error("catalog unavailable");
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(
      screen.getAllByText("Couldn’t load cloud models").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Local providers")).toBeTruthy();
    expect(screen.getByText("Ollama")).toBeTruthy();
    expect(screen.getByText("LM Studio")).toBeTruthy();
  });

  it("does not leave a trailing separator after Recent", () => {
    mocks.settings.recentModels = [{ provider: "openai", name: "gpt-5" }];

    render(<ModelPicker />);

    const recentRow = document.querySelector(
      '[data-model-provider="openai"][data-model-name="gpt-5"]',
    );
    expect(recentRow).not.toBeNull();
    expect(recentRow?.nextElementSibling?.getAttribute("data-slot")).not.toBe(
      "dropdown-menu-separator",
    );
  });

  it("lists Ollama and LM Studio directly under Local providers", () => {
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    const allModelsMenu = screen.getByTestId("more-models-submenu");
    const localProviders = within(allModelsMenu).getByText("Local providers");
    const cloudProviders = within(allModelsMenu).getByText("Cloud providers");
    expect(
      localProviders.compareDocumentPosition(cloudProviders) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(allModelsMenu).getByText("Ollama")).toBeTruthy();
    expect(within(allModelsMenu).getByText("LM Studio")).toBeTruthy();
    expect(screen.queryByText("Local models")).toBeNull();
  });

  it("opens nested navigation submenus on hover with forgiving pointer timing", () => {
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    const getTrigger = (label: string) =>
      screen
        .getAllByText(label)
        .map((element) => element.closest("button"))
        .find((element): element is HTMLButtonElement => element !== null)!;

    for (const label of [
      "All models",
      "Google Vertex AI",
      "Ollama",
      "LM Studio",
    ]) {
      const trigger = getTrigger(label);
      expect(trigger.dataset.openOnHover).toBe("true");
      expect(trigger.dataset.hoverDelay).toBe("120");
      expect(trigger.dataset.closeDelay).toBe("100");
    }

    expect(getTrigger("Google Vertex AI").getAttribute("aria-label")).toBe(
      "Google Vertex AI. 1 model. Opens submenu",
    );
    expect(getTrigger("Ollama").getAttribute("aria-label")).toBe(
      "Ollama. None available. Opens submenu",
    );

    expect(
      screen.getByText("GPT 5").closest("button")?.dataset.openOnHover,
    ).toBeUndefined();
  });

  it("gives model-list menus room while keeping model metadata separate", () => {
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(screen.getByTestId("more-models-submenu").className).toContain(
      "w-[min(20rem,calc(100vw-1.5rem))]",
    );

    const modelName = screen.getAllByText("GPT 5")[0];
    expect(modelName.className).toContain("block max-w-full truncate");
    expect(modelName.getAttribute("title")).toBeNull();
    expect(modelName.closest("button")?.firstElementChild?.className).toContain(
      "grid-cols-[minmax(0,1fr)_auto]",
    );
  });

  it("groups secondary providers under Cloud providers regardless of price", () => {
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(screen.getByText("Cloud providers")).toBeTruthy();
    expect(screen.queryByText("Other providers")).toBeNull();
    const vertexModels = screen.getByTestId("other-provider-models-vertex");
    expect(
      within(vertexModels).getByText("Vertex Gemini 2.5 Pro"),
    ).toBeTruthy();
    expect(screen.getAllByText("Vertex Gemini 2.5 Pro")).toHaveLength(1);
  });

  it("selects Auto Sidekick and moves Build mode to Agent", async () => {
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("Auto Sidekick").closest("button")!);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: {
          name: "auto-sidekick",
          provider: "auto",
        },
        selectedChatMode: "local-agent",
      });
    });
  });

  it("shows the Auto Sidekick display name in the selected-model trigger", () => {
    mocks.settings.selectedModel = {
      name: "auto-sidekick",
      provider: "auto",
    };

    render(<ModelPicker />);

    expect(screen.getByTestId("model-picker").textContent).toContain(
      "Auto Sidekick",
    );
    expect(screen.getByTestId("model-picker").textContent).not.toContain(
      "Medium",
    );
    expect(screen.getByTestId("model-picker").textContent).not.toContain(
      "auto-sidekick",
    );
  });

  it("omits effort from the trigger and selects catalog-defined effort from a model submenu", async () => {
    mocks.renderSubContent = true;
    render(<ModelPicker />);

    expect(screen.getByTestId("model-picker").textContent).toContain("Auto");
    expect(screen.getByTestId("model-picker").textContent).not.toContain(
      "Medium",
    );
    expect(screen.getByTestId("model-picker").className).toContain(
      "max-w-[220px]",
    );
    expect(screen.getByTestId("model-picker-dropdown").className).toContain(
      "w-[min(20rem,calc(100vw-1.5rem))]",
    );
    const gpt5Row = screen.getAllByText("GPT 5")[0].closest("button")!;
    expect(
      gpt5Row.querySelector("[data-effort-chevron]")?.previousElementSibling
        ?.textContent,
    ).toBe("Min");
    expect(gpt5Row.getAttribute("aria-label")).toContain("Effort: Minimal");
    expect(
      gpt5Row.querySelector("[data-effort-level]")?.getAttribute("title"),
    ).toBeNull();
    fireEvent.click(gpt5Row.querySelector("[data-effort-chevron]")!);
    fireEvent.click(screen.getAllByText("Xhigh")[0]);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: { name: "gpt-5", provider: "openai" },
        recentModels: [{ name: "gpt-5", provider: "openai" }],
        modelEffortPreferences: {
          '["openai","gpt-5",null]': "xhigh",
        },
      });
    });
  });

  it("offers and persists None effort for Ollama models", async () => {
    mocks.ollamaModels = [
      {
        provider: "ollama",
        modelName: "qwen3-coder:30b",
        displayName: "Qwen3 Coder 30B",
      },
    ];
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    const qwenRow = screen.getByText("Qwen3 Coder 30B").closest("button")!;
    expect(qwenRow.getAttribute("aria-label")).toContain("Effort: Medium");
    fireEvent.click(screen.getByText("None"));

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: {
          name: "qwen3-coder:30b",
          provider: "ollama",
        },
        recentModels: [
          {
            name: "qwen3-coder:30b",
            provider: "ollama",
          },
        ],
        modelEffortPreferences: {
          '["ollama","qwen3-coder:30b",null]': "none",
        },
      });
    });
  });

  it("only opens the effort submenu from its chevron", () => {
    mocks.renderSubContent = true;
    render(<ModelPicker />);

    const gpt5Row = screen.getByText("GPT 5").closest("button")!;
    fireEvent.mouseDown(gpt5Row);
    expect(mocks.preventBaseUIHandler).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(gpt5Row.querySelector("[data-effort-chevron]")!);
    expect(mocks.preventBaseUIHandler).toHaveBeenCalledTimes(1);
  });

  it("disables selection while an existing chat is still loading", () => {
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };
    mocks.chatLoading = true;

    render(<ModelPicker />);

    expect(
      (screen.getByTestId("model-picker") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.updateChat).not.toHaveBeenCalled();
  });

  it("persists an established chat model through the optimistic mutation", async () => {
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };
    mocks.chat = {
      id: 42,
      messages: [{ id: 1 }],
      modelSelection: {
        provider: "auto",
        name: "auto",
        effortLevel: "medium",
      },
    };
    mocks.renderSubContent = true;

    render(<ModelPicker />);
    fireEvent.click(screen.getAllByText("Xhigh")[0]);

    await waitFor(() => {
      expect(mocks.setChatSelection).toHaveBeenCalledWith({
        modelSelection: {
          provider: "openai",
          name: "gpt-5",
          effortLevel: "xhigh",
        },
      });
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      modelEffortPreferences: {
        '["openai","gpt-5",null]': "xhigh",
      },
      recentModels: [{ name: "gpt-5", provider: "openai" }],
    });
    expect(mocks.updateChat).not.toHaveBeenCalled();
  });

  it("selects a subscription-eligible model in an existing chat without replacing its history", async () => {
    mocks.renderSubContent = true;
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };
    mocks.chat = {
      id: 42,
      messages: [{ id: 1 }],
      modelSelection: { provider: "auto", name: "auto", effortLevel: "medium" },
    };
    render(<ModelPicker />);
    fireEvent.click(screen.getAllByText("GPT 5")[0]);
    await waitFor(() =>
      expect(mocks.setChatSelection).toHaveBeenCalledWith({
        modelSelection: expect.objectContaining({
          provider: "openai",
          name: "gpt-5",
        }),
      }),
    );
    expect(mocks.chat.messages).toEqual([{ id: 1 }]);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "replaces price with ChatGPT plan for subscription models (selected: %s)",
    (selected) => {
      mocks.renderSubContent = true;
      if (selected) {
        mocks.settings.selectedModel = { provider: "openai", name: "gpt-5" };
      }
      render(<ModelPicker />);

      const row = screen.getAllByRole("button", {
        name: /^GPT 5\. ChatGPT plan\./,
      })[0];
      expect(within(row).getByText("ChatGPT plan")).toBeTruthy();
      expect(within(row).queryByTestId("price-badge")).toBeNull();
      expect(row.getAttribute("aria-label")).toContain("ChatGPT plan");
      expect(row.getAttribute("aria-label")).not.toContain("Price:");
    },
  );

  it.each(["disconnected", "pro"])(
    "keeps the price badge when subscription usage is %s",
    (mode) => {
      mocks.renderSubContent = true;
      if (mode === "disconnected") mocks.subscriptionConnected = false;
      else mocks.settings.proModelUsage = "pro";
      render(<ModelPicker />);

      const row = screen.getAllByText("GPT 5")[0].closest("button")!;
      expect(within(row).queryByText("ChatGPT plan")).toBeNull();
      expect(within(row).getByTestId("price-badge")).toBeTruthy();
      expect(row.getAttribute("aria-label")).toContain("Price:");
    },
  );

  it("sorts the All models catalog by price and provider", () => {
    mocks.renderSubContent = true;
    render(<ModelPicker />);

    const modelNames = [
      "GPT 5 Mini",
      "Gemini 2.5 Pro",
      "Gemini 2.5 Flash",
      "Claude Sonnet 4.5",
      "GPT 5",
    ];
    const modelOrder = Array.from(document.querySelectorAll("button"))
      .map((button) =>
        modelNames.find((name) =>
          Array.from(button.querySelectorAll("span")).some(
            (span) => span.textContent === name,
          ),
        ),
      )
      .filter((name): name is string => Boolean(name));

    expect(modelOrder).toEqual([
      "GPT 5",
      "GPT 5 Mini",
      "Gemini 2.5 Pro",
      "Gemini 2.5 Flash",
      "Claude Sonnet 4.5",
    ]);
  });

  it("keeps the non-Pro root compact while preserving its Dyad choices", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(screen.queryByText("Auto Sidekick")).toBeNull();
    expect(screen.queryByText("Auto (balanced)")).toBeNull();
    expect(screen.queryByText("GPT 5")).toBeNull();
    expect(screen.getByText("All models")).toBeTruthy();
    expect(screen.queryByText("Other AI providers")).toBeNull();
    expect(screen.queryByText("Dyad Free")).toBeNull();
    expect(screen.getByText("Free (OpenRouter)")).toBeTruthy();
  });

  it("shows Auto (balanced) to Dyad Pro users", () => {
    render(<ModelPicker />);

    expect(screen.getByText("Auto (balanced)")).toBeTruthy();
  });

  it.each([true, false])(
    "only defers OpenAI locks while loading (%s)",
    (loading) => {
      mocks.subscriptionLoading = loading;
      mocks.subscriptionUnavailable = true;
      mocks.settings.enableDyadPro = false;
      mocks.settings.providerSettings.auto.apiKey.value = "";
      mocks.renderSubContent = true;
      render(<ModelPicker />);
      expect(screen.getByText("GPT 5").closest("button")?.dataset.locked).toBe(
        loading ? undefined : "true",
      );
      expect(screen.queryByText("ChatGPT plan")).toBeNull();
    },
  );

  it("unlocks only subscription-supported models for free users", async () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;
    render(<ModelPicker />);
    const supported = screen.getByText("GPT 5").closest("button")!;
    expect(supported.dataset.locked).toBeUndefined();
    expect(within(supported).getByText("ChatGPT plan")).toBeTruthy();
    expect(
      screen.getByText("GPT 5 Mini").closest("button")?.dataset.locked,
    ).toBe("true");
    fireEvent.click(supported);
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedModel: expect.objectContaining({
            provider: "openai",
            name: "gpt-5",
          }),
        }),
      ),
    );
  });

  it("marks models without a provider key as locked for non-Pro users", () => {
    mocks.subscriptionConnected = false;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settings.providerSettings.openrouter.apiKey.value = "openrouter-key";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(screen.getByText("GPT 5").closest("button")?.dataset.locked).toBe(
      "true",
    );
    expect(
      screen
        .getByText("GPT 5")
        .closest("button")
        ?.querySelector("[data-effort-chevron]"),
    ).toBeNull();
    expect(
      screen.getAllByText("Claude Sonnet 4.5")[0].closest("button")?.dataset
        .locked,
    ).toBeUndefined();
    expect(
      document.querySelector<HTMLElement>(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )?.dataset.locked,
    ).toBeUndefined();
  });

  it("opens the unlock dialog instead of selecting a locked model", () => {
    mocks.subscriptionConnected = false;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "model-picker:locked-model-click",
      { provider: "openai", model: "gpt-5" },
    );
    expect(screen.getByText("Unlock GPT 5 with Dyad Pro")).toBeTruthy();
  });

  it("opens the Pro upgrade page from the unlock dialog", () => {
    mocks.subscriptionConnected = false;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);
    fireEvent.click(screen.getByText("Get Dyad Pro"));

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("utm_campaign=model-picker-locked-model"),
    );
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "model-picker:upgrade-click",
      {
        source: "locked-model-dialog",
        provider: "openai",
        model: "gpt-5",
      },
    );
    expect(screen.queryByText("Get Dyad Pro")).toBeNull();
  });

  it("navigates to provider settings from the unlock dialog own-key link", () => {
    mocks.subscriptionConnected = false;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);
    fireEvent.click(screen.getByText(/use your own/));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/providers/$provider",
      params: { provider: "openai" },
    });
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("lets non-Pro users select models from providers with their own key", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settings.providerSettings.openrouter.apiKey.value = "openrouter-key";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    fireEvent.click(
      screen.getAllByText("Claude Sonnet 4.5")[0].closest("button")!,
    );

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: expect.objectContaining({
          name: "anthropic/claude-sonnet-4.5",
          provider: "openrouter",
        }),
        recentModels: [
          {
            name: "anthropic/claude-sonnet-4.5",
            provider: "openrouter",
          },
        ],
      }),
    );
  });

  it("does not lock models while settings and env vars are still loading", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settingsLoading = true;
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(document.querySelector("[data-locked]")).toBeNull();
  });

  it("labels locked models for assistive tech", () => {
    mocks.subscriptionConnected = false;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    expect(
      screen.getByText("GPT 5").closest("button")?.getAttribute("aria-label"),
    ).toBe("GPT 5 — requires Dyad Pro or an API key from OpenAI");
  });

  it("points locked free models at an OpenRouter key instead of Pro", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.renderSubContent = true;

    render(<ModelPicker />);

    fireEvent.click(
      document.querySelector(
        '[data-model-provider="openrouter"][data-model-name="openrouter/free"]',
      )!,
    );

    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "model-picker:locked-model-click",
      { provider: "openrouter", model: "openrouter/free" },
    );
    expect(screen.queryByText("Get Dyad Pro")).toBeNull();

    fireEvent.click(screen.getByText("Add OpenRouter API key"));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/providers/$provider",
      params: { provider: "openrouter" },
    });
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("shows the unlock-all footer only for non-Pro users", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    fireEvent.click(
      screen.getByText("Unlock all models with Dyad Pro").closest("button")!,
    );

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("utm_campaign=model-picker-unlock-all"),
    );
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "model-picker:upgrade-click",
      { source: "unlock-all-footer" },
    );
  });

  it("hides the unlock-all footer for Pro users", () => {
    render(<ModelPicker />);

    expect(screen.queryByText("Unlock all models with Dyad Pro")).toBeNull();
    expect(document.querySelector("[data-locked]")).toBeNull();
  });

  it("shows data sharing disclosure on Auto for non-Pro users with an OpenRouter key", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settings.providerSettings.openrouter.apiKey.value = "openrouter-key";

    render(<ModelPicker />);

    const autoRow = document.querySelector<HTMLElement>(
      '[data-model-provider="auto"][data-model-name="auto"]',
    );
    expect(autoRow?.textContent).toContain("Data sharing");
    expect(autoRow?.getAttribute("aria-label")).toContain("Data sharing");
  });

  it("shows data sharing disclosure on Auto for non-Pro users with OPENROUTER_API_KEY", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.envVars.OPENROUTER_API_KEY = "openrouter-env-key";

    render(<ModelPicker />);

    expect(
      document.querySelector<HTMLElement>(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )?.textContent,
    ).toContain("Data sharing");
  });

  it("does not show data sharing disclosure on Auto without an OpenRouter key", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(
      document.querySelector<HTMLElement>(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )?.textContent,
    ).not.toContain("Data sharing");
  });

  it("shows data sharing disclosure on the top-level Free OpenRouter model", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(
      screen.getAllByText("Free (OpenRouter)")[0].closest("button")
        ?.textContent,
    ).toContain("Data sharing");
  });

  it("shows data sharing disclosure on explicit free OpenRouter provider models", () => {
    mocks.renderSubContent = true;
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(screen.getAllByText("Free (OpenRouter)").length).toBe(2);
    expect(screen.getAllByText("Data sharing").length).toBeGreaterThan(1);
  });

  it("selects flat Pro models with their source provider", async () => {
    mocks.renderSubContent = true;
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: expect.objectContaining({
          name: "gpt-5",
          provider: "openai",
        }),
        recentModels: [{ name: "gpt-5", provider: "openai" }],
      }),
    );
    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
    });
  });

  it("hides Dyad Free for Dyad Pro trial users", () => {
    mocks.isTrial = true;

    render(<ModelPicker />);

    expect(screen.queryByText("Dyad Free")).toBeNull();
    expect(
      screen.getByText("Upgrade from Dyad Pro trial to unlock more models."),
    ).toBeTruthy();
    const autoRow = document.querySelector<HTMLElement>(
      '[data-model-provider="auto"][data-model-name="auto"]',
    )!;
    expect(
      autoRow.querySelector("[data-effort-chevron]")?.previousElementSibling
        ?.textContent,
    ).toBe("Med");
  });

  it("does not select Dyad Free when quota is exhausted", () => {
    mocks.freeModelQuota.isQuotaExceeded = true;
    mocks.freeModelQuota.messagesRemaining = 0;
    mocks.freeModelQuota.quotaStatus = {
      messagesUsed: 5,
      messagesLimit: 5,
      messagesRemaining: 0,
      isQuotaExceeded: true,
      resetTime: new Date("2026-06-26T00:00:00Z").getTime(),
    };

    render(<ModelPicker />);

    fireEvent.click(screen.getByText("Dyad Free").closest("button")!);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("moves Build mode to Agent when selecting Dyad Free", async () => {
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("Dyad Free").closest("button")!);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: expect.objectContaining({
          name: "free-pro",
          provider: "auto",
        }),
        selectedChatMode: "local-agent",
        defaultChatMode: "local-agent",
      });
    });
  });

  it("updates an established chat model and fallback mode atomically", async () => {
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };
    mocks.chat = {
      id: 42,
      messages: [{ id: 1 }],
      modelSelection: {
        provider: "openai",
        name: "gpt-5",
        effortLevel: "high",
      },
    };

    render(<ModelPicker />);
    fireEvent.click(screen.getByText("Dyad Free").closest("button")!);

    await waitFor(() => {
      expect(mocks.setChatSelection).toHaveBeenCalledWith({
        chatMode: "local-agent",
        modelSelection: expect.objectContaining({
          name: "free-pro",
          provider: "auto",
        }),
      });
    });
    expect(mocks.setChatMode).not.toHaveBeenCalled();
    expect(mocks.setChatModelSelection).not.toHaveBeenCalled();
  });

  it("shows direct models without subscription or Dyad Free labels in BYO mode", () => {
    mocks.settings.proModelUsage = "api-key";
    mocks.renderSubContent = true;
    render(<ModelPicker />);
    expect(screen.queryByText("Dyad Free")).toBeNull();
    expect(screen.queryAllByText("ChatGPT plan")).toHaveLength(0);
    expect(
      document.querySelector('[data-model-provider="openai"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-model-provider="openrouter"][data-model-name="openrouter/free"]',
      ),
    ).not.toBeNull();
  });

  it("shows Dyad Free quota as unavailable when the quota fetch fails", () => {
    mocks.freeModelQuota.error = new Error("quota unavailable");
    mocks.freeModelQuota.quotaStatus = null;

    render(<ModelPicker />);

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("10/10 left")).toBeNull();
  });
});

describe("Claude Code subscription picker", () => {
  beforeEach(() => {
    mocks.isTrial = false;
    mocks.anthropicModels = [];
    mocks.settings.proModelUsage = "subscription";
    mocks.settings.recentModels = [];
    mocks.settings.selectedModel = { provider: "auto", name: "auto" };
    mocks.renderSubContent = true;
    mocks.claudeStatus.compatible = true;
    mocks.claudeModels = [
      { value: "sonnet", displayName: "sonnet", description: "" },
    ];
    mocks.claudeModelsError = false;
    mocks.refetchClaudeModels.mockClear();
    mocks.refetchClaudeStatus.mockClear();
    Object.assign(mocks.settings, { enableClaudeCodeSubscription: true });
    mocks.pathname = "/chat";
    mocks.search = { id: 7 };
    mocks.chat = {
      id: 7,
      appId: 9,
      executionBackend: "dyad",
      messages: [{ id: 1 }],
      modelSelection: { provider: "auto", name: "auto", effortLevel: "medium" },
    };
    mocks.claudeStatus.connected = true;
    mocks.createChat.mockClear();
    mocks.setChatSelection.mockClear();
  });
  it("renders discovered labels and selects the CLI value, including new model variants", async () => {
    mocks.chat!.messages = [];
    mocks.claudeModels = [
      {
        value: "opus[1m]",
        displayName: "Opus (1M context)",
        description: "From installed CLI",
      },
    ];
    render(<ModelPicker />);
    expect(screen.queryByText("Claude Code — sonnet")).toBeNull();
    fireEvent.click(screen.getByText("Opus (1M context)"));
    await waitFor(() =>
      expect(mocks.setChatSelection).toHaveBeenCalledWith({
        modelSelection: expect.objectContaining({
          provider: "claude-code",
          name: "opus[1m]",
        }),
      }),
    );
  });
  it.each([
    ["Fable", "Fable"],
    ["Default (recommended)", "Default"],
    ["Opus (1M context)", "Opus"],
  ])(
    "shows %s without parenthetical details before the backend",
    (displayName, shortName) => {
      mocks.chat!.modelSelection = {
        provider: "claude-code",
        name: "claude-fable-5-1[1m]",
        effortLevel: "medium",
      };
      mocks.claudeModels = [
        {
          value: "claude-fable-5-1[1m]",
          displayName,
          description: "",
        },
      ];
      render(<ModelPicker />);
      const trigger = screen.getByTestId("model-picker");
      expect(trigger.textContent).toBe(`${shortName} (Claude Code)`);
      expect(trigger.getAttribute("title")).toBe(`${shortName} (Claude Code)`);
    },
  );
  it.each(["loading", "error", "empty"])(
    "shows the %s catalog state without hardcoded choices",
    (state) => {
      mocks.claudeModels = state === "empty" ? [] : undefined;
      mocks.claudeModelsError = state === "error";
      render(<ModelPicker />);
      expect(screen.queryByText("Claude Code — sonnet")).toBeNull();
      expect(
        document.querySelector(
          '[data-model-provider="claude-code"][data-model-name="claude-sonnet-4-5"]',
        ),
      ).not.toBeNull();
      if (state === "error")
        expect(
          screen.getByText(/Could not load Claude Code suggestions/),
        ).toBeTruthy();
    },
  );
  it("refreshes both the connection and the model catalog", () => {
    render(<ModelPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
    expect(mocks.refetchClaudeModels).toHaveBeenCalledOnce();
    expect(mocks.forceStatus).toHaveBeenCalledWith({ force: true });
  });
  it.each(["claude-fable-5", "claude-fable-5-1"])(
    "routes %s through Claude Code without substituting versions",
    async (name) => {
      mocks.chat!.messages = [];
      mocks.anthropicModels = [
        {
          apiName: "claude-fable-5",
          displayName: "Claude Fable 5",
          dollarSigns: 5,
        },
        {
          apiName: "claude-fable-5-1",
          displayName: "Claude Fable 5.1",
          dollarSigns: 3,
        },
      ];
      mocks.claudeModels = [
        {
          value: "claude-fable-5-1[1m]",
          resolvedModel: "claude-fable-5-1",
          displayName: "Fable",
          description: "",
        },
      ];
      render(<ModelPicker />);
      const row = document.querySelector(
        `[data-model-provider="claude-code"][data-model-name="${name}"]`,
      )!;
      expect(within(row as HTMLElement).getByText("Claude Code")).toBeTruthy();
      expect(row.querySelector("[data-effort-chevron]")).toBeNull();
      expect(
        document.querySelector(
          `[data-model-provider="anthropic"][data-model-name="${name}"]`,
        ),
      ).toBeNull();
      expect(
        document.querySelector('[data-model-name="claude-fable-5-1[1m]"]'),
      ).toBeNull();
      fireEvent.click(row);
      await waitFor(() =>
        expect(mocks.setChatSelection).toHaveBeenCalledWith({
          modelSelection: expect.objectContaining({
            provider: "claude-code",
            name,
          }),
        }),
      );
    },
  );
  it("preserves the existing Fable 5 API selection until a backend switch is confirmed", () => {
    mocks.anthropicModels = [
      { apiName: "claude-fable-5", displayName: "Claude Fable 5" },
    ];
    mocks.chat!.modelSelection = {
      provider: "anthropic",
      name: "claude-fable-5",
      effortLevel: "medium",
    };
    render(<ModelPicker />);
    expect(screen.getByTestId("model-picker").textContent).toBe(
      "Claude Fable 5",
    );
    expect(mocks.setChatSelection).not.toHaveBeenCalled();
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="claude-fable-5"]',
      )!,
    );
    expect(
      screen.getByText("Start a new chat with Claude Code — Fable 5?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mocks.createChat).not.toHaveBeenCalled();
  });
  it("restores API routing when Pro usage is selected", async () => {
    mocks.settings.proModelUsage = "pro";
    mocks.anthropicModels = [
      { apiName: "claude-fable-5", displayName: "Claude Fable 5" },
    ];
    render(<ModelPicker />);
    expect(
      document.querySelector('[data-model-provider="claude-code"]'),
    ).toBeNull();
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="anthropic"][data-model-name="claude-fable-5"]',
      )!,
    );
    await waitFor(() =>
      expect(mocks.setChatSelection).toHaveBeenCalledWith({
        modelSelection: expect.objectContaining({
          provider: "anthropic",
          name: "claude-fable-5",
        }),
      }),
    );
  });
  it("places Claude Code status and usage in a branded subscription submenu", () => {
    mocks.renderSubContent = false;
    render(<ModelPicker />);
    const trigger = screen.getByRole("button", {
      name: "Claude Code subscription. Experimental. Open submenu.",
    });
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByText("Refresh connection")).toBeNull();
    expect(screen.queryByText("Claude Code — sonnet")).toBeNull();
  });
  it("keeps Claude Code catalog choices available during a Dyad trial", () => {
    mocks.isTrial = true;
    render(<ModelPicker />);
    expect(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-model-provider="openai"][data-model-name="gpt-5"]',
      ),
    ).toBeNull();
    mocks.isTrial = false;
  });
  it("consolidates API and Claude Code recent models into the CLI route", () => {
    mocks.anthropicModels = [
      { apiName: "claude-fable-5", displayName: "Claude Fable 5" },
    ];
    mocks.settings.recentModels = [
      { provider: "anthropic", name: "claude-fable-5" },
      { provider: "claude-code", name: "claude-fable-5" },
    ];
    render(<ModelPicker />);
    expect(
      document.querySelectorAll(
        '[data-model-provider="anthropic"][data-model-name="claude-fable-5"]',
      ),
    ).toHaveLength(0);
    // One CLI entry in All models and one in Recent, regardless of API history.
    expect(
      document.querySelectorAll(
        '[data-model-provider="claude-code"][data-model-name="claude-fable-5"]',
      ),
    ).toHaveLength(2);
  });
  it("hides cached catalog choices when discovery fails", () => {
    mocks.claudeModelsError = true;
    render(<ModelPicker />);
    expect(screen.queryByText("Claude Code — sonnet")).toBeNull();
  });
  it.each(["connected", "compatible"] as const)(
    "keeps API catalog routes when %s is false",
    (field) => {
      mocks.claudeStatus[field] = false;
      render(<ModelPicker />);
      expect(
        document.querySelector('[data-model-provider="claude-code"]'),
      ).toBeNull();
      expect(
        document.querySelector(
          '[data-model-provider="openrouter"][data-model-name="anthropic/claude-sonnet-4.5"]',
        ),
      ).not.toBeNull();
    },
  );
  it.each(["dyad", "claude-code"] as const)(
    "switches an empty %s chat in place without asking for a new chat",
    async (backend) => {
      mocks.chat!.messages = [];
      mocks.chat!.executionBackend = backend;
      mocks.chat!.modelSelection = undefined;
      render(<ModelPicker />);
      fireEvent.click(
        backend === "dyad"
          ? document.querySelector(
              '[data-model-provider="claude-code"][data-model-name="sonnet"]',
            )!
          : document.querySelector(
              '[data-model-provider="auto"][data-model-name="auto"]',
            )!,
      );
      await waitFor(() =>
        expect(mocks.setChatSelection).toHaveBeenCalledWith({
          modelSelection: expect.objectContaining({
            provider: backend === "dyad" ? "claude-code" : "auto",
          }),
        }),
      );
      expect(screen.queryByText("Start a new chat?")).toBeNull();
      expect(mocks.createChat).not.toHaveBeenCalled();
    },
  );
  it("selects Claude Code in an empty chat without a consent dialog", async () => {
    mocks.chat!.messages = [];
    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      )!,
    );
    expect(screen.queryByText("Use Claude Code subscription?")).toBeNull();
    expect(screen.queryByText("Start a new chat?")).toBeNull();
    await waitFor(() => expect(mocks.setChatSelection).toHaveBeenCalled());
    expect(mocks.createChat).not.toHaveBeenCalled();
  });
  it("shows the experiment toggle when disabled while hiding Claude Code model choices", async () => {
    Object.assign(mocks.settings, {
      enableClaudeCodeSubscription: false,
      proModelUsage: "pro",
      recentModels: [{ provider: "claude-code", name: "sonnet" }],
    });
    render(<ModelPicker />);
    expect(
      screen.getByRole("button", {
        name: "Claude Code subscription. Experimental. Open submenu.",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Claude Code — sonnet")).toBeNull();
    expect(screen.queryByText("Checking Claude Code connection…")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: "Use Claude subscription",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        enableClaudeCodeSubscription: true,
        proModelUsage: "subscription",
      }),
    );
  });
  it("preserves the existing chat when backend switching is cancelled", () => {
    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      )!,
    );
    expect(
      screen.getByText(
        "Claude Code can’t continue this conversation. Your current chat will be saved, but its messages won’t carry over.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(mocks.setChatSelection).not.toHaveBeenCalled();
  });
  it("uses the chat backend rather than the global model", async () => {
    mocks.chat!.executionBackend = "dyad";
    mocks.settings.selectedModel = { provider: "claude-code", name: "sonnet" };
    mocks.renderSubContent = true;
    render(<ModelPicker />);
    fireEvent.click(screen.getByText("GPT 5").closest("button")!);
    await waitFor(() => expect(mocks.setChatSelection).toHaveBeenCalled());
    expect(screen.queryByText(/Start a new chat with/)).toBeNull();
    expect(mocks.createChat).not.toHaveBeenCalled();
  });
  it("names the destination model when leaving Claude Code and omits the disclosure", () => {
    mocks.chat!.executionBackend = "claude-code";
    mocks.chat!.messages = [{ id: 1 }, { id: 2 }];
    mocks.renderSubContent = true;
    render(<ModelPicker />);
    fireEvent.click(screen.getByText("GPT 5").closest("button")!);
    expect(screen.getByText("Start a new chat with GPT 5?")).toBeTruthy();
    expect(
      screen.getByText(
        "This conversation uses Claude Code and can’t continue with GPT 5. Your current chat will be saved, but its messages won’t carry over.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/shell tools are disabled/)).toBeNull();
  });
  it("keeps switching between Claude Code models in the same conversation", async () => {
    mocks.chat!.executionBackend = "claude-code";
    mocks.chat!.messages = [{ id: 1 }];
    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      )!,
    );
    await waitFor(() => expect(mocks.setChatSelection).toHaveBeenCalled());
    expect(screen.queryByText(/Start a new chat with/)).toBeNull();
  });
  it("clears a failed backend switch when cancelled and reopened", async () => {
    mocks.createChat.mockRejectedValueOnce(new Error("Switch failed"));
    render(<ModelPicker />);
    const pick = () =>
      fireEvent.click(
        document.querySelector(
          '[data-model-provider="claude-code"][data-model-name="sonnet"]',
        )!,
      );
    pick();
    fireEvent.click(screen.getByText("Start new chat"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Switch failed"),
    );
    fireEvent.click(screen.getByText("Cancel"));
    pick();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("creates a Claude Code chat after only the new-chat confirmation", async () => {
    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      )!,
    );
    expect(
      screen.getByText("Start a new chat with Claude Code — sonnet?"),
    ).toBeTruthy();
    expect(screen.queryByText(/shell tools are disabled/)).toBeNull();
    fireEvent.click(screen.getByText("Start new chat"));
    expect(screen.queryByText("Use Claude Code subscription?")).toBeNull();
    await waitFor(() => expect(mocks.createChat).toHaveBeenCalled());
  });
  it.each(["free-pro", "auto-sidekick"])(
    "applies compatible mode when switching from Claude to %s",
    async (name) => {
      mocks.selectedMode = "build";
      mocks.chat!.executionBackend = "claude-code";
      mocks.chat!.messages = [{ id: 1 }];
      render(<ModelPicker />);
      fireEvent.click(
        document.querySelector(
          `[data-model-provider="auto"][data-model-name="${name}"]`,
        )!,
      );
      fireEvent.click(screen.getByText("Start new chat"));
      await waitFor(() =>
        expect(mocks.createChat).toHaveBeenCalledWith(
          expect.objectContaining({
            initialChatMode: "local-agent",
            modelSelection: expect.objectContaining({ provider: "auto", name }),
          }),
        ),
      );
      expect(mocks.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ selectedChatMode: "local-agent" }),
      );
    },
  );
  it("creates a new chat in the same app with the chosen backend model", async () => {
    mocks.settings.recentModels = [{ provider: "openai", name: "gpt-5" }];
    render(<ModelPicker />);
    fireEvent.click(
      document.querySelector(
        '[data-model-provider="claude-code"][data-model-name="sonnet"]',
      )!,
    );
    fireEvent.click(screen.getByText("Start new chat"));
    await waitFor(() =>
      expect(mocks.createChat).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 9,
          modelSelection: expect.objectContaining({
            provider: "claude-code",
            name: "sonnet",
          }),
        }),
      ),
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        recentModels: expect.arrayContaining([
          { provider: "openai", name: "gpt-5" },
          { provider: "claude-code", name: "sonnet" },
        ]),
      }),
    );
    expect(mocks.setChatSelection).not.toHaveBeenCalled();
  });
});
