import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { ProviderSettingsPage } from "./ProviderSettingsPage";

const mocks = vi.hoisted(() => ({
  anyProviderSetup: false,
  hasArmedPayload: false,
  navigate: vi.fn(),
  routerBack: vi.fn(),
  updateSettings: vi.fn(),
  validateProviderApiKey: vi.fn(),
  getFreeAgentQuotaStatus: vi.fn(),
  openExternalUrl: vi.fn(),
  sendFirstPrompt: vi.fn(),
  isQuotaExceeded: false,
  isQuotaLoading: false,
  settings: {
    providerSettings: {},
    enableDyadPro: false,
    defaultChatMode: "build",
  } as any,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({
    history: {
      length: 1,
      back: mocks.routerBack,
    },
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    envVars: {},
    loading: false,
    error: null,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    data: [
      {
        id: "google",
        name: "Google",
        type: "local",
        envVarName: "GOOGLE_API_KEY",
        websiteUrl: "https://example.com/api-keys",
      },
      {
        id: "anthropic",
        name: "Anthropic",
        type: "cloud",
        envVarName: "ANTHROPIC_API_KEY",
        websiteUrl: "https://example.com/api-keys",
      },
    ],
    isLoading: false,
    error: null,
    isAnyProviderSetup: () => mocks.anyProviderSetup,
  }),
}));

vi.mock("@/hooks/useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({
    isQuotaExceeded: mocks.isQuotaExceeded,
    isLoading: mocks.isQuotaLoading,
  }),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => ({ hasArmedPayload: mocks.hasArmedPayload }),
}));

vi.mock("@/first_prompt/FirstPromptProvider", () => ({
  useFirstPromptSend: () => mocks.sendFirstPrompt,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      validateProviderApiKey: mocks.validateProviderApiKey,
    },
    freeAgentQuota: {
      getFreeAgentQuotaStatus: mocks.getFreeAgentQuotaStatus,
    },
    system: {
      openExternalUrl: mocks.openExternalUrl,
    },
  },
}));

function validationError(message: string, kind: DyadErrorKind) {
  return Object.assign(new Error(message), { kind });
}

function renderProviderSettingsPage(provider = "google") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<ProviderSettingsPage provider={provider} />, {
    wrapper: Wrapper,
  });
}

async function saveApiKey(providerName = "Google", provider = "google") {
  fireEvent.change(screen.getByLabelText(`Set ${providerName} API Key`), {
    target: { value: "test-google-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

  await waitFor(() => {
    expect(mocks.validateProviderApiKey).toHaveBeenCalledWith({
      provider,
      apiKey: "test-google-key",
    });
  });
}

describe("ProviderSettingsPage", () => {
  beforeEach(() => {
    mocks.anyProviderSetup = false;
    mocks.hasArmedPayload = false;
    mocks.navigate.mockReset();
    mocks.routerBack.mockReset();
    mocks.updateSettings.mockReset();
    mocks.validateProviderApiKey.mockReset();
    mocks.getFreeAgentQuotaStatus.mockReset();
    mocks.openExternalUrl.mockReset();
    mocks.sendFirstPrompt.mockReset();
    mocks.isQuotaExceeded = false;
    mocks.isQuotaLoading = false;
    mocks.settings = {
      providerSettings: {},
      enableDyadPro: false,
      defaultChatMode: "build",
    };
  });

  it("titles auth validation errors as rejected API keys", async () => {
    mocks.validateProviderApiKey.mockRejectedValue(
      validationError("Google rejected this API key.", DyadErrorKind.Auth),
    );

    renderProviderSettingsPage();
    await saveApiKey();

    expect(await screen.findByText("API key rejected")).not.toBeNull();
    expect(screen.queryByText("API key check failed")).toBeNull();
  });

  it("notifies the first-prompt saga after saving the first provider", async () => {
    mocks.hasArmedPayload = true;
    mocks.validateProviderApiKey.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);

    renderProviderSettingsPage();
    await saveApiKey();

    await waitFor(() =>
      expect(mocks.sendFirstPrompt).toHaveBeenCalledWith({
        type: "PROVIDER_CONFIGURED",
        defaultChatMode: "build",
      }),
    );
    expect(mocks.navigate).not.toHaveBeenCalledWith({
      to: "/",
      search: {},
      replace: true,
    });
  });

  it("resumes an implicit first prompt with the new Dyad Pro default", async () => {
    mocks.hasArmedPayload = true;
    mocks.validateProviderApiKey.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);

    renderProviderSettingsPage("auto");
    await saveApiKey("Dyad", "auto");

    await waitFor(() =>
      expect(mocks.sendFirstPrompt).toHaveBeenCalledWith({
        type: "PROVIDER_CONFIGURED",
        defaultChatMode: "local-agent",
      }),
    );
  });

  it("waits for quota before resuming an implicit first prompt", async () => {
    mocks.hasArmedPayload = true;
    mocks.isQuotaLoading = true;
    mocks.settings = {
      providerSettings: {},
      enableDyadPro: false,
    };
    mocks.updateSettings.mockResolvedValue(undefined);
    let resolveQuota!: (value: {
      messagesUsed: number;
      messagesLimit: number;
      isQuotaExceeded: boolean;
      windowStartTime: null;
      resetTime: null;
      hoursUntilReset: null;
    }) => void;
    mocks.getFreeAgentQuotaStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveQuota = resolve;
      }),
    );

    renderProviderSettingsPage("anthropic");
    fireEvent.change(screen.getByLabelText("Set Anthropic API Key"), {
      target: { value: "test-anthropic-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalled());
    expect(mocks.sendFirstPrompt).not.toHaveBeenCalled();

    resolveQuota({
      messagesUsed: 0,
      messagesLimit: 5,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    });

    await waitFor(() =>
      expect(mocks.sendFirstPrompt).toHaveBeenCalledWith({
        type: "PROVIDER_CONFIGURED",
        defaultChatMode: "local-agent",
      }),
    );
  });

  it("does not auto-submit when replacing an existing provider key", async () => {
    mocks.anyProviderSetup = true;
    mocks.hasArmedPayload = true;
    mocks.validateProviderApiKey.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);

    renderProviderSettingsPage();
    await saveApiKey();

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalled());
    expect(mocks.sendFirstPrompt).not.toHaveBeenCalled();
  });

  it("nudges toward Paste & Save after returning from the provider website", async () => {
    renderProviderSettingsPage();

    expect(screen.queryByText(/Copied your API key/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Setup API Key" }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://example.com/api-keys",
    );
    // The nudge should wait until the user comes back to the window.
    expect(screen.queryByText(/Copied your API key/)).toBeNull();

    fireEvent.focus(window);
    expect(await screen.findByText(/Copied your API key/)).not.toBeNull();

    // Typing a key manually dismisses the nudge.
    fireEvent.change(screen.getByLabelText("Set Google API Key"), {
      target: { value: "typed-key" },
    });
    await waitFor(() => {
      expect(screen.queryByText(/Copied your API key/)).toBeNull();
    });
  });

  it.each([
    [DyadErrorKind.RateLimited, "Google rate limited the API key check."],
    [
      DyadErrorKind.External,
      "Google did not respond while checking this API key.",
    ],
  ])(
    "titles %s validation errors as unverified API keys",
    async (kind, message) => {
      mocks.validateProviderApiKey.mockRejectedValue(
        validationError(message, kind),
      );

      renderProviderSettingsPage();
      await saveApiKey();

      expect(
        await screen.findByText("Could not verify API key"),
      ).not.toBeNull();
      expect(screen.queryByText("API key check failed")).toBeNull();
    },
  );
});
