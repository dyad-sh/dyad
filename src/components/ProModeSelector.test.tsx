import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProModeSelector } from "./ProModeSelector";
const mocks = vi.hoisted(() => ({
  connected: true,
  claudeConnected: false,
  claudeEnabled: false,
  usage: undefined as string | undefined,
  hasProKey: true,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableDyadPro: true,
      enableClaudeCodeSubscription: mocks.claudeEnabled,
      proModelUsage: mocks.usage,
      providerSettings: {
        auto: { apiKey: { value: mocks.hasProKey ? "test-pro" : "" } },
      },
    },
    updateSettings: mocks.update,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { connected: mocks.claudeConnected, compatible: true },
  }),
}));
vi.mock("@/hooks/useSubscriptionAccount", () => ({
  useSubscriptionAccount: () => ({ data: { connected: mocks.connected } }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));
beforeEach(() => {
  mocks.connected = true;
  mocks.claudeConnected = false;
  mocks.claudeEnabled = false;
  mocks.usage = undefined;
  mocks.hasProKey = true;
  vi.clearAllMocks();
});
it("allows subscription usage when only Claude Code is connected", async () => {
  mocks.connected = false;
  mocks.claudeConnected = true;
  mocks.claudeEnabled = true;
  mocks.usage = "pro";
  const user = userEvent.setup();
  render(<ProModeSelector />);
  await user.click(screen.getByRole("button", { name: "Pro" }));
  await user.click(screen.getByRole("button", { name: "Subscriptions" }));
  expect(mocks.update).toHaveBeenCalledWith({ proModelUsage: "subscription" });
});
it("defaults to subscription when connected and writes a global preference", async () => {
  const user = userEvent.setup();
  render(<ProModeSelector />);
  await user.click(screen.getByRole("button", { name: "Pro" }));
  expect(
    screen.getByRole("button", { name: "ChatGPT Subscription" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Pro credits" }));
  expect(mocks.update).toHaveBeenCalledWith({ proModelUsage: "pro" });
});
it("disables subscription when disconnected", async () => {
  mocks.connected = false;
  const user = userEvent.setup();
  render(<ProModeSelector />);
  await user.click(screen.getByRole("button", { name: "Pro" }));
  expect(
    screen.getByRole("button", { name: "ChatGPT Subscription" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pro credits" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it.each(["click", "keyboard"])(
  "persists Pro credits from a disconnected subscription preference via %s",
  async (method) => {
    mocks.connected = false;
    mocks.usage = "subscription";
    const user = userEvent.setup();
    render(<ProModeSelector />);
    await user.click(screen.getByRole("button", { name: "Pro" }));
    const credits = screen.getByRole("button", { name: "Pro credits" });
    expect(credits).toHaveAttribute("aria-pressed", "true");
    if (method === "click") await user.click(credits);
    else {
      credits.focus();
      await user.keyboard("{Enter}");
    }
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      proModelUsage: "pro",
    });
  },
);

it("selects BYO without requiring keys or changing the selected model", async () => {
  mocks.connected = false;
  const user = userEvent.setup();
  render(<ProModeSelector />);
  await user.click(screen.getByRole("button", { name: "Pro" }));
  await user.click(
    screen.getByRole("button", { name: "Your API keys & local" }),
  );
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
    proModelUsage: "api-key",
  });
});

it.each([true, false])(
  "keeps BYO selected with subscription connected=%s and explains billing",
  async (connected) => {
    mocks.connected = connected;
    mocks.usage = "api-key";
    const user = userEvent.setup();
    render(<ProModeSelector />);
    await user.click(screen.getByRole("button", { name: "Pro" }));
    expect(
      screen.getByRole("button", { name: "Your API keys & local" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Provider charges apply separately/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Pro credits" }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      proModelUsage: "pro",
    });
  },
);

it.each(["chatgpt", "claude"])(
  "allows leaving BYO for %s after the Pro key is removed",
  async (subscription) => {
    mocks.hasProKey = false;
    mocks.usage = "api-key";
    mocks.connected = subscription === "chatgpt";
    mocks.claudeEnabled = subscription === "claude";
    mocks.claudeConnected = subscription === "claude";
    const user = userEvent.setup();
    render(<ProModeSelector />);
    await user.click(screen.getByRole("button", { name: "Pro" }));
    expect(
      screen.getByRole("button", { name: "Your API keys & local" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pro credits" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Enable Dyad Pro" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.click(
      screen.getByRole("button", {
        name:
          subscription === "chatgpt" ? "ChatGPT Subscription" : "Subscriptions",
      }),
    );
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      proModelUsage: "subscription",
    });
  },
);
