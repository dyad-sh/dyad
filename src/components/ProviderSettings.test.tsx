import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsGrid } from "./ProviderSettings";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refetch: vi.fn(),
  deleteProvider: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    data: [
      {
        id: "openai",
        name: "OpenAI",
        type: "cloud",
        hasFreeTier: false,
      },
      {
        id: "ollama",
        name: "Ollama",
        type: "local",
        hasFreeTier: false,
      },
      {
        id: "auto",
        name: "Meta Human OS",
        type: "cloud",
        hasFreeTier: false,
      },
      {
        id: "phantom",
        name: "Phantom (Hermes)",
        type: "cloud",
        hasFreeTier: false,
      },
    ],
    isLoading: false,
    error: null,
    isProviderSetup: (provider: string) => provider === "ollama",
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/routes/settings/providers/$provider", () => ({
  providerSettingsRoute: { id: "/settings/providers/$provider" },
}));

vi.mock("@/hooks/useLanguageModelsByProviders", () => ({
  useLanguageModelsByProviders: () => ({
    data: {
      openai: [
        { apiName: "gpt-5", displayName: "GPT-5" },
        { apiName: "gpt-5-mini", displayName: "GPT-5 mini" },
      ],
      ollama: [{ apiName: "qwen3", displayName: "Qwen 3" }],
    },
  }),
}));

vi.mock("@/hooks/useCustomLanguageModelProvider", () => ({
  useCustomLanguageModelProvider: () => ({
    deleteProvider: mocks.deleteProvider,
    isDeleting: false,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      providerSettings: {
        ollama: { apiBaseUrl: "http://localhost:11434" },
      },
    },
  }),
}));

vi.mock("@/hooks/useLocalProviderStatus", () => ({
  useLocalProviderStatus: (providerId: string) =>
    providerId === "ollama"
      ? {
          status: "online",
          server: {
            models: [{ modelName: "qwen3" }],
          },
          refresh: vi.fn(),
        }
      : { status: "offline", refresh: vi.fn() },
}));

vi.mock("@/components/CreateCustomProviderDialog", () => ({
  CreateCustomProviderDialog: () => null,
}));

describe("ProviderSettingsGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows provider readiness and available model counts", () => {
    render(<ProviderSettingsGrid />);

    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Configure to use")).toBeTruthy();
    expect(screen.getByText("2 models")).toBeTruthy();
    expect(screen.getByText("Ollama")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("1 model")).toBeTruthy();
  });

  it("opens the selected provider configuration", () => {
    render(<ProviderSettingsGrid />);

    fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/providers/$provider",
      params: { provider: "openai" },
    });
  });

  it("hides internal routing providers from Settings", () => {
    render(<ProviderSettingsGrid />);

    expect(screen.queryByText("Meta Human OS")).toBeNull();
    expect(screen.queryByText("Phantom (Hermes)")).toBeNull();
  });
});
