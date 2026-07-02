import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { ProviderSettingsPage } from "./ProviderSettingsPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerBack: vi.fn(),
  updateSettings: vi.fn(),
  validateProviderApiKey: vi.fn(),
  openExternalUrl: vi.fn(),
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
    settings: {
      providerSettings: {},
      enableDyadPro: false,
    },
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
      },
    ],
    isLoading: false,
    error: null,
    isAnyProviderSetup: () => false,
  }),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => false,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      validateProviderApiKey: mocks.validateProviderApiKey,
    },
    system: {
      openExternalUrl: mocks.openExternalUrl,
    },
  },
}));

function validationError(message: string, kind: DyadErrorKind) {
  return Object.assign(new Error(message), { kind });
}

function renderProviderSettingsPage() {
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

  return render(<ProviderSettingsPage provider="google" />, {
    wrapper: Wrapper,
  });
}

async function saveApiKey() {
  fireEvent.change(screen.getByLabelText("Set Google API Key"), {
    target: { value: "test-google-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

  await waitFor(() => {
    expect(mocks.validateProviderApiKey).toHaveBeenCalledWith({
      provider: "google",
      apiKey: "test-google-key",
    });
  });
}

describe("ProviderSettingsPage", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.routerBack.mockReset();
    mocks.updateSettings.mockReset();
    mocks.validateProviderApiKey.mockReset();
    mocks.openExternalUrl.mockReset();
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
