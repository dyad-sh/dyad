import "@testing-library/jest-dom/vitest";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupBanner } from "./SetupBanner";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  navigate: vi.fn(),
  pending: false,
  settingsLoading: false,
  subscriptionLoading: false,
  pro: false,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.mock("@/first_prompt/FirstPromptProvider", () => ({
  useFirstPromptSaga: () => ({ hasArmedPayload: true }),
}));
vi.mock("@/routes/settings/providers/$provider", () => ({
  providerSettingsRoute: { id: "/settings/providers/$provider" },
}));
vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isAnyProviderSetup: () => false,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useScrollAndNavigateTo", () => ({
  useScrollAndNavigateTo: () => mocks.navigate,
}));
vi.mock("@/hooks/useSubscriptionAccount", () => ({
  useSubscriptionAccount: () => ({
    data: mocks.subscriptionLoading
      ? undefined
      : { connected: false, pending: mocks.pending },
    isLoading: mocks.subscriptionLoading,
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settingsLoading
      ? undefined
      : {
          enableDyadPro: mocks.pro,
          providerSettings: mocks.pro
            ? { auto: { apiKey: { value: "pro-key" } } }
            : {},
        },
  }),
}));
vi.mock("./ProBanner", () => ({ SetupDyadProButton: () => null }));
vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      connectCodexSubscription: mocks.connect,
      disconnectCodexSubscription: mocks.disconnect,
    },
    system: { openExternalUrl: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsLoading = false;
  mocks.subscriptionLoading = false;
  mocks.pending = false;
  mocks.pro = false;
});
function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SetupBanner variant="dialog" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("offers ChatGPT sign-in without a Pro key and keeps other providers accessible", async () => {
  const user = setup();
  expect(
    screen.queryByRole("button", { name: "Google Free" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/No Dyad usage fees/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*Free$/,
    }),
  ).toBeVisible();
  expect(screen.getByText(/Your prompt is saved/)).toBeVisible();
  await user.click(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*Free$/,
    }),
  );
  expect(mocks.connect).toHaveBeenCalledWith({
    acceptCharges: true,
    selectModel: true,
  });
  await user.click(screen.getByRole("button", { name: "Other providers" }));
  expect(mocks.navigate).toHaveBeenCalled();
});
it("keeps sign-in errors visible so users can retry", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("Secure storage unavailable"));
  const user = setup();
  await user.click(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*Free$/,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Secure storage unavailable",
  );
  expect(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*Free$/,
    }),
  ).toBeEnabled();
});
it("keeps the pending provider disabled and offers a separate cancellation action", async () => {
  mocks.pending = true;
  const user = setup();
  const cancelButton = screen.getByRole("button", { name: "Cancel sign-in" });
  expect(cancelButton).toBeEnabled();
  const providerButton = screen.getByRole("button", {
    name: /^ChatGPT subscription .*needed\.$/,
  });
  expect(providerButton).toBeDisabled();
  await user.click(providerButton);
  expect(mocks.disconnect).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  await user.click(cancelButton);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("omits subscription pricing when Pro is active", () => {
  mocks.pro = true;
  setup();
  expect(screen.queryByText(/1.5 Pro credits/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*needed\.$/,
    }),
  ).toBeVisible();
  expect(screen.queryByText(/No Dyad usage fees/)).not.toBeInTheDocument();
});

it("waits for settings before showing fees or permitting connection", () => {
  mocks.settingsLoading = true;
  setup();
  expect(screen.getByText("Checking Dyad Pro status…")).toBeVisible();
  expect(screen.queryByText(/No Dyad usage fees/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*needed\.$/,
    }),
  ).toBeDisabled();
});
it("waits for subscription status before showing the Free badge", () => {
  mocks.subscriptionLoading = true;
  setup();
  expect(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*needed\.$/,
    }),
  ).toBeDisabled();
});
it("announces the browser sign-in wait", () => {
  mocks.pending = true;
  setup();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for ChatGPT sign-in in your browser",
  );
});

it("preserves Pro model and mode preferences when connecting", async () => {
  mocks.pro = true;
  const user = setup();
  await user.click(
    screen.getByRole("button", {
      name: /^ChatGPT subscription .*needed\.$/,
    }),
  );
  expect(mocks.connect).toHaveBeenCalledWith({
    acceptCharges: true,
    selectModel: false,
  });
});

it("lists the ChatGPT subscription first with its subtitle while loading", () => {
  mocks.subscriptionLoading = true;
  setup();
  const options = screen
    .getAllByRole("button")
    .filter((button) =>
      /ChatGPT subscription|OpenRouter|Other providers/.test(
        button.textContent ?? "",
      ),
    );
  expect(options.map((button) => button.textContent)).toEqual([
    "ChatGPT subscriptionSign in with your ChatGPT account. No API key needed.",
    "OpenRouterFree",
    "Other providers",
  ]);
});
