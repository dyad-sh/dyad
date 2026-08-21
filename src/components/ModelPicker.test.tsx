import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setChatMode: vi.fn(),
  setChatModelSelection: vi.fn(),
  setChatSelection: vi.fn(),
  updateSettings: vi.fn(),
  updateChat: vi.fn(),
  navigate: vi.fn(),
  posthogCapture: vi.fn(),
  openExternalUrl: vi.fn(),
  preventBaseUIHandler: vi.fn(),
  selectedMode: "build",
  isTrial: false,
  renderSubContent: false,
  settingsLoading: false,
  chatLoading: false,
  chat: null as null | {
    id: number;
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
    },
    selectedChatMode: "build",
    defaultChatMode: "build",
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
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
    isLoading: false,
    data: {
      auto: [
        {
          apiName: "auto",
          displayName: "Auto",
          description: "Automatically selects a model",
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
    ],
  }),
}));

vi.mock("@/hooks/useLocalModels", () => ({
  useLocalModels: () => ({
    models: mocks.ollamaModels,
    loading: false,
    error: null,
    loadModels: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLMStudioModels", () => ({
  useLocalLMSModels: () => ({
    models: [],
    loading: false,
    error: null,
    loadModels: vi.fn(),
  }),
}));

vi.mock("@/components/PriceBadge", () => ({
  PriceBadge: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactElement }) => render,
  TooltipContent: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
  DropdownMenuItem: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({
    children,
    hideChevron: _hideChevron,
    onMouseDown,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    hideChevron?: boolean;
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
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) =>
    mocks.renderSubContent ? <div>{children}</div> : null,
}));

describe("ModelPicker", () => {
  beforeEach(() => {
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
    mocks.preventBaseUIHandler.mockReset();
    mocks.selectedMode = "build";
    mocks.renderSubContent = false;
    mocks.settingsLoading = false;
    mocks.chatLoading = false;
    mocks.chat = null;
    mocks.pathname = "/";
    mocks.search = {};
    mocks.envVars = {};
    mocks.ollamaModels = [];
    mocks.settings.enableDyadPro = true;
    mocks.settings.providerSettings.auto.apiKey.value = "dyad-pro-key";
    mocks.settings.providerSettings.openrouter.apiKey.value = "";
    mocks.settings.selectedModel = { name: "auto", provider: "auto" };
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

  it("shows Pro users a flat primary cloud model list with provider grouping under More models", () => {
    render(<ModelPicker />);

    expect(screen.getByText("Auto Sidekick")).toBeTruthy();
    expect(
      screen.getByText("Auto Sidekick").closest("button")?.textContent,
    ).toContain("New");
    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("GLM 4.7")).toBeNull();
    expect(screen.queryByText("Kimi K2")).toBeNull();
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
    expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
    expect(screen.queryByText("Grok Code Fast")).toBeNull();
    expect(screen.queryByText("xAI")).toBeNull();
    expect(screen.getByText("More models")).toBeTruthy();
    expect(screen.queryByText("Other AI providers")).toBeNull();
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
      "w-[320px]",
    );
    const gpt5Row = screen.getAllByText("GPT 5")[0].closest("button")!;
    expect(
      gpt5Row.querySelector("[data-effort-chevron]")?.previousElementSibling
        ?.textContent,
    ).toBe("Minimal");
    expect(gpt5Row.getAttribute("aria-label")).toContain("Effort: Minimal");
    fireEvent.click(gpt5Row.querySelector("[data-effort-chevron]")!);
    fireEvent.click(screen.getAllByText("Xhigh")[0]);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: { name: "gpt-5", provider: "openai" },
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
        modelEffortPreferences: {
          '["ollama","qwen3-coder:30b",null]': "none",
        },
      });
    });
  });

  it("only opens the effort submenu from its chevron", () => {
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
    expect(mocks.updateChat).not.toHaveBeenCalled();
  });

  it("sorts the Pro flat list by price descending and groups same-price models by provider", () => {
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

  it("shows non-Pro users the same tiered flat list with More models", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(screen.queryByText("Auto Sidekick")).toBeNull();
    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.getByText("More models")).toBeTruthy();
    expect(screen.queryByText("Other AI providers")).toBeNull();
    expect(screen.queryByText("Grok Code Fast")).toBeNull();
    expect(screen.queryByText("Dyad Free")).toBeNull();
    expect(screen.getByText("Free (OpenRouter)")).toBeTruthy();
  });

  it("marks models without a provider key as locked for non-Pro users", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settings.providerSettings.openrouter.apiKey.value = "openrouter-key";

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
      screen.getByText("Claude Sonnet 4.5").closest("button")?.dataset.locked,
    ).toBeUndefined();
    expect(
      document.querySelector<HTMLElement>(
        '[data-model-provider="auto"][data-model-name="auto"]',
      )?.dataset.locked,
    ).toBeUndefined();
  });

  it("opens the unlock dialog instead of selecting a locked model", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

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
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

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
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

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

    render(<ModelPicker />);

    fireEvent.click(screen.getByText("Claude Sonnet 4.5").closest("button")!);

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      selectedModel: expect.objectContaining({
        name: "anthropic/claude-sonnet-4.5",
        provider: "openrouter",
      }),
    });
  });

  it("does not lock models while settings and env vars are still loading", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settingsLoading = true;

    render(<ModelPicker />);

    expect(document.querySelector("[data-locked]")).toBeNull();
  });

  it("labels locked models for assistive tech", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

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

    // Index 0 is the top-level auto "Free (OpenRouter)" row (never locked);
    // index 1 is the OpenRouter submenu's free model.
    fireEvent.click(
      screen.getAllByText("Free (OpenRouter)")[1].closest("button")!,
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
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      selectedModel: expect.objectContaining({
        name: "gpt-5",
        provider: "openai",
      }),
    });
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
    ).toBe("Medium");
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

  it("shows Dyad Free quota as unavailable when the quota fetch fails", () => {
    mocks.freeModelQuota.error = new Error("quota unavailable");
    mocks.freeModelQuota.quotaStatus = null;

    render(<ModelPicker />);

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("10/10 left")).toBeNull();
  });
});
