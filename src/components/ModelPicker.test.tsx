import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateSettings: vi.fn(),
  navigate: vi.fn(),
  posthogCapture: vi.fn(),
  settingsLoading: false,
  configuredProviders: new Set<string>(),
  settings: {
    providerSettings: {},
    selectedModel: {
      name: "claude-sonnet-4-6",
      provider: "anthropic",
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
    loading: mocks.settingsLoading,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
}));

vi.mock("@/routes/settings/providers/$provider", () => ({
  providerSettingsRoute: { id: "/settings/providers/$provider" },
}));

vi.mock("@/hooks/useLanguageModelsByProviders", () => ({
  useLanguageModelsByProviders: () => ({
    isLoading: false,
    data: {
      openai: [
        {
          apiName: "gpt-5",
          displayName: "GPT 5",
          description: "OpenAI model",
          dollarSigns: 3,
          type: "cloud",
        },
        {
          apiName: "gpt-5-mini",
          displayName: "GPT 5 Mini",
          description: "OpenAI smaller model",
          dollarSigns: 2,
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
    isProviderSetup: (provider: string) =>
      mocks.configuredProviders.has(provider),
    data: [
      { id: "openai", name: "OpenAI", type: "cloud" },
      { id: "google", name: "Google", type: "cloud" },
      { id: "xai", name: "xAI", type: "cloud", secondary: true },
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

vi.mock("@/components/PriceBadge", () => ({ PriceBadge: () => null }));
vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  TooltipContent: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubContent: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("ModelPicker", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.updateSettings.mockReset();
    mocks.navigate.mockReset();
    mocks.posthogCapture.mockReset();
    mocks.settingsLoading = false;
    mocks.configuredProviders.clear();
  });

  it("shows primary cloud models in price tiers and groups other providers", () => {
    render(<ModelPicker />);

    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Value")).toBeTruthy();
    expect(screen.getByText("GPT 5")).toBeTruthy();
    expect(screen.getByText("Gemini 2.5 Pro")).toBeTruthy();
    expect(screen.getByText("More models")).toBeTruthy();
    expect(screen.queryByText("Grok Code Fast")).toBeNull();
    expect(screen.queryByText("Auto")).toBeNull();
  });

  it("locks cloud models whose provider has no API key", () => {
    render(<ModelPicker />);

    const model = screen.getByText("GPT 5").closest("button");
    expect(model?.dataset.locked).toBe("true");
    expect(model?.getAttribute("aria-label")).toBe(
      "GPT 5 requires an API key from OpenAI",
    );
  });

  it("opens provider settings instead of selecting a locked model", () => {
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("GPT 5").closest("button")!);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Add a OpenAI API key to use GPT 5")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Open provider settings" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/providers/$provider",
      params: { provider: "openai" },
    });
  });

  it("selects a model when its provider is configured", () => {
    mocks.configuredProviders.add("google");
    render(<ModelPicker />);

    fireEvent.click(screen.getByText("Gemini 2.5 Pro").closest("button")!);

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      selectedModel: {
        name: "gemini-2.5-pro",
        provider: "google",
        customModelId: undefined,
      },
    });
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("does not show stale locks while settings are loading", () => {
    mocks.settingsLoading = true;
    render(<ModelPicker />);

    expect(document.querySelector("[data-locked]")).toBeNull();
  });
});
