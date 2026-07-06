import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setChatMode: vi.fn(),
  updateSettings: vi.fn(),
  selectedMode: "build",
  isTrial: false,
  renderSubContent: false,
  envVars: {} as Record<string, string | undefined>,
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
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({
    location: {
      pathname: "/",
      search: {},
    },
  }),
}));

vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: () => ({
    selectedMode: mocks.selectedMode,
    setChatMode: mocks.setChatMode,
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
    models: [],
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
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
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
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) =>
    mocks.renderSubContent ? <div>{children}</div> : null,
}));

describe("ModelPicker", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.setChatMode.mockReset();
    mocks.setChatMode.mockResolvedValue(undefined);
    mocks.updateSettings.mockReset();
    mocks.selectedMode = "build";
    mocks.renderSubContent = false;
    mocks.envVars = {};
    mocks.settings.enableDyadPro = true;
    mocks.settings.providerSettings.auto.apiKey.value = "dyad-pro-key";
    mocks.settings.providerSettings.openrouter.apiKey.value = "";
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

    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("GLM 4.7")).toBeNull();
    expect(screen.queryByText("Kimi K2")).toBeNull();
    expect(screen.queryByText("Free (OpenRouter)")).toBeNull();
    expect(screen.getByText("Dyad Free")).toBeTruthy();
    expect(screen.getByText("2/5 left")).toBeTruthy();
    expect(screen.getByText("Data sharing")).toBeTruthy();
    expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
    expect(screen.queryByText("Grok Code Fast")).toBeNull();
    expect(screen.queryByText("xAI")).toBeNull();
    expect(screen.getByText("More models")).toBeTruthy();
    expect(screen.queryByText("Other AI providers")).toBeNull();
  });

  it("sorts the Pro flat list by price descending and groups same-price models by provider", () => {
    render(<ModelPicker />);

    const modelOrder = Array.from(document.querySelectorAll("button"))
      .map((button) => button.textContent?.trim())
      .filter((text) =>
        [
          "GPT 5 Mini",
          "Gemini 2.5 Pro",
          "Gemini 2.5 Flash",
          "Claude Sonnet 4.5",
          "GPT 5",
        ].includes(text ?? ""),
      );

    expect(modelOrder).toEqual([
      "GPT 5",
      "GPT 5 Mini",
      "Gemini 2.5 Pro",
      "Gemini 2.5 Flash",
      "Claude Sonnet 4.5",
    ]);
  });

  it("keeps non-Pro users on provider grouping with Other AI providers", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Other AI providers")).toBeTruthy();
    expect(screen.queryByText("More models")).toBeNull();
    expect(screen.queryByText("GPT 5")).toBeNull();
    expect(screen.queryByText("Grok Code Fast")).toBeNull();
    expect(screen.queryByText("Dyad Free")).toBeNull();
  });

  it("shows data sharing disclosure on Auto for non-Pro users with an OpenRouter key", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.settings.providerSettings.openrouter.apiKey.value = "openrouter-key";

    render(<ModelPicker />);

    expect(
      screen.getAllByText("Auto")[1].closest("button")?.textContent,
    ).toContain("Data sharing");
  });

  it("shows data sharing disclosure on Auto for non-Pro users with OPENROUTER_API_KEY", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    mocks.envVars.OPENROUTER_API_KEY = "openrouter-env-key";

    render(<ModelPicker />);

    expect(
      screen.getAllByText("Auto")[1].closest("button")?.textContent,
    ).toContain("Data sharing");
  });

  it("does not show data sharing disclosure on Auto without an OpenRouter key", () => {
    mocks.settings.enableDyadPro = false;
    mocks.settings.providerSettings.auto.apiKey.value = "";

    render(<ModelPicker />);

    expect(
      screen.getAllByText("Auto")[1].closest("button")?.textContent,
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

  it("selects flat Pro models with their source provider", () => {
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      selectedModel: expect.objectContaining({
        name: "gpt-5",
        provider: "openai",
      }),
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("hides Dyad Free for Dyad Pro trial users", () => {
    mocks.isTrial = true;

    render(<ModelPicker />);

    expect(screen.queryByText("Dyad Free")).toBeNull();
    expect(
      screen.getByText("Upgrade from Dyad Pro trial to unlock more models."),
    ).toBeTruthy();
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
      expect(mocks.setChatMode).toHaveBeenCalledWith("local-agent");
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: expect.objectContaining({
          name: "free-pro",
          provider: "auto",
        }),
        defaultChatMode: "local-agent",
      });
    });
  });

  it("shows Dyad Free quota as unavailable when the quota fetch fails", () => {
    mocks.freeModelQuota.error = new Error("quota unavailable");
    mocks.freeModelQuota.quotaStatus = null;

    render(<ModelPicker />);

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("10/10 left")).toBeNull();
  });
});
