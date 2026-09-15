import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { SubscriptionModelMenu } from "./SubscriptionModelMenu";
const mocks = vi.hoisted(() => ({
  connected: false,
  credentialError: false,
  settingsLoading: false,
  pro: true,
  fastMode: false,
  statusError: undefined as string | undefined,
  updateSettings: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    updateSettings: mocks.updateSettings,
    settings: mocks.settingsLoading
      ? undefined
      : {
          enableDyadPro: mocks.pro,
          chatgptFastMode: mocks.fastMode,
          providerSettings: mocks.pro
            ? { auto: { apiKey: { value: "test-key" } } }
            : {},
        },
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      getCodexSubscriptionStatus: async () => ({
        connected: mocks.connected,
        error: mocks.statusError,
        credentialError: mocks.credentialError,
        planType: "plus",
        pending: false,
        models: ["gpt-test"],
        windows: [
          { usedPercent: 25, windowSeconds: 18000, resetsAt: 2000000000000 },
        ],
        limitReached: false,
      }),
      connectCodexSubscription: mocks.connect,
      disconnectCodexSubscription: mocks.disconnect,
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsLoading = false;
  mocks.connected = false;
  mocks.credentialError = false;
  mocks.pro = true;
  mocks.fastMode = false;
  mocks.statusError = undefined;
  mocks.updateSettings.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
async function open() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger>Models</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SubscriptionModelMenu>
            <DropdownMenuItem>Example model</DropdownMenuItem>
          </SubscriptionModelMenu>
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Models" }));
  await user.hover(
    screen.getByRole("menuitem", { name: /Subscription.*Open submenu/ }),
  );
  return user;
}
it.each([false, true])(
  "saves Fast mode from %s without closing the submenu",
  async (enabled) => {
    mocks.connected = true;
    mocks.fastMode = enabled;
    const user = await open();
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: /Fast mode/,
    });
    expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    expect(toggle).toHaveTextContent("Faster responses, 2x ChatGPT usage");
    await user.click(toggle);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      chatgptFastMode: !enabled,
    });
    expect(toggle).toBeVisible();
  },
);

it("shows Fast mode save failures without closing the submenu", async () => {
  mocks.connected = true;
  mocks.updateSettings.mockRejectedValueOnce(
    new Error("Could not save settings"),
  );
  const user = await open();
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: /Fast mode/ }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save settings",
  );
  expect(
    screen.getByRole("menuitemcheckbox", { name: /Fast mode/ }),
  ).toHaveAttribute("aria-checked", "false");
});

it("opens on hover and keeps connection errors visible in the real Base UI menu", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("Secure storage unavailable"));
  const user = await open();
  const connect = await screen.findByRole("menuitem", {
    name: "Connect with ChatGPT",
  });
  await waitFor(() =>
    expect(connect).not.toHaveAttribute("aria-disabled", "true"),
  );
  await user.click(connect);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Secure storage unavailable",
  );
  expect(connect).toBeVisible();
  expect(screen.queryByText("gpt-test")).not.toBeInTheDocument();
});
it("shows account usage limits without a duplicate model catalog", async () => {
  mocks.connected = true;
  await open();
  expect(await screen.findByText("5-hour")).toBeVisible();
  expect(screen.getByText("Plus")).toBeVisible();
  expect(screen.getByText("Plus").parentElement).toHaveTextContent(
    "ChatGPT subscription",
  );
  expect(
    screen.getByText("Get up to 5× usage with your ChatGPT subscription."),
  ).toBeVisible();
  expect(screen.getByText(/1.5 Pro credits/)).toBeVisible();
  expect(screen.getByText("New")).toBeVisible();
  expect(screen.getByText("25% used")).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Disconnect ChatGPT" }),
  ).toBeVisible();
});
it("replaces models with subscription details in narrow windows and returns with Back", async () => {
  vi.stubGlobal("innerWidth", 300);
  const user = await open();
  await user.click(
    screen.getByRole("menuitem", { name: /Subscription.*Open submenu/ }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Back to models" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "Example model" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Back to models" }));
  expect(screen.getByRole("menuitem", { name: "Example model" })).toBeVisible();
});
it("allows free users to connect and explains the Basic Agent limit", async () => {
  mocks.pro = false;
  const user = await open();
  const connect = await screen.findByRole("menuitem", {
    name: "Connect with ChatGPT",
  });
  await waitFor(() =>
    expect(connect).not.toHaveAttribute("aria-disabled", "true"),
  );
  await user.click(connect);
  expect(mocks.connect).toHaveBeenCalledWith({
    acceptCharges: true,
    selectModel: true,
  });
  expect(
    screen.getByText(
      /defaults for new chats. Existing chats keep their model selection/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/no Dyad usage fees/)).toBeVisible();
  expect(screen.getByText(/Basic Agent limits still apply/)).toBeVisible();
  expect(screen.queryByText(/1.5 Pro credits/)).not.toBeInTheDocument();
});

it("does not offer connection until billing settings are loaded", async () => {
  mocks.settingsLoading = true;
  await open();
  expect(await screen.findByText("Checking Dyad Pro status…")).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Connect with ChatGPT" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("keeps connected copy neutral while billing settings load", async () => {
  mocks.settingsLoading = true;
  mocks.connected = true;
  await open();
  expect(await screen.findByText("Checking Dyad Pro status…")).toBeVisible();
  expect(
    screen.queryByText("Disconnect ChatGPT to use your OpenAI API key."),
  ).toBeNull();
});
it("offers disconnect when stored credentials cannot be read", async () => {
  mocks.pro = false;
  mocks.credentialError = true;
  const user = await open();
  const disconnect = await screen.findByRole("menuitem", {
    name: "Disconnect ChatGPT",
  });
  await waitFor(() =>
    expect(disconnect).not.toHaveAttribute("aria-disabled", "true"),
  );
  await user.click(disconnect);
  expect(
    screen.getByText(/Your saved ChatGPT connection could not be opened/),
  ).toBeVisible();
  expect(screen.queryByText(/Connecting sets/)).toBeNull();
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it.each([false, true])(
  "hides Fast mode without a usable connection (credential error: %s)",
  async (credentialError) => {
    mocks.credentialError = credentialError;
    await open();
    const action = await screen.findByRole("menuitem", {
      name: credentialError ? "Disconnect ChatGPT" : "Connect with ChatGPT",
    });
    await waitFor(() =>
      expect(action).not.toHaveAttribute("aria-disabled", "true"),
    );
    expect(
      screen.queryByRole("menuitemcheckbox", { name: /Fast mode/ }),
    ).not.toBeInTheDocument();
  },
);

it("clears a failed Fast mode save when disconnect starts and shows its error", async () => {
  mocks.connected = true;
  mocks.updateSettings.mockRejectedValueOnce(
    new Error("Could not save settings"),
  );
  let rejectDisconnect!: (error: Error) => void;
  mocks.disconnect.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectDisconnect = reject;
      }),
  );
  const user = await open();
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: /Fast mode/ }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save settings",
  );
  await user.click(
    screen.getByRole("menuitem", { name: "Disconnect ChatGPT" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  rejectDisconnect(new Error("Could not disconnect ChatGPT"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not disconnect ChatGPT",
  );
});

it("keeps subscription status errors visible alongside Fast mode save errors", async () => {
  mocks.connected = true;
  mocks.statusError = "Subscription status unavailable";
  mocks.updateSettings.mockRejectedValueOnce(
    new Error("Could not save settings"),
  );
  const user = await open();
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: /Fast mode/ }),
  );
  expect(await screen.findByText("Could not save settings")).toBeVisible();
  expect(screen.getByText("Subscription status unavailable")).toBeVisible();
});
