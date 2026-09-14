import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProModeSelector } from "./ProModeSelector";
const mocks = vi.hoisted(() => ({
  connected: true,
  usage: undefined as string | undefined,
  update: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableDyadPro: true,
      proModelUsage: mocks.usage,
      providerSettings: { auto: { apiKey: { value: "test-pro" } } },
    },
    updateSettings: mocks.update,
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
  mocks.usage = undefined;
  vi.clearAllMocks();
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
