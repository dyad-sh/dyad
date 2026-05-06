import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateSettings: vi.fn(),
  settings: {
    enableDyadPro: true,
    providerSettings: {
      auto: {
        apiKey: {
          value: "dyad-pro-key",
        },
      },
    },
    selectedModel: {
      name: "auto",
      provider: "auto",
    },
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
  }),
}));

vi.mock("@/hooks/useTrialModelRestriction", () => ({
  useTrialModelRestriction: () => ({
    isTrial: false,
  }),
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
          displayName: "Free",
          description: "Free model",
          type: "cloud",
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
  DropdownMenuSubContent: () => null,
}));

describe("ModelPicker", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.updateSettings.mockReset();
    mocks.settings.enableDyadPro = true;
    mocks.settings.providerSettings.auto.apiKey.value = "dyad-pro-key";
  });

  it("shows Pro users a flat primary cloud model list with provider grouping under More models", () => {
    render(<ModelPicker />);

    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("GLM 4.7")).toBeNull();
    expect(screen.queryByText("Kimi K2")).toBeNull();
    expect(screen.queryByText("Free (OpenRouter)")).toBeNull();
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
});
