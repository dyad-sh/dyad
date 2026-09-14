import "@testing-library/jest-dom/vitest";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "./ui/dropdown-menu";
import { SubscriptionModelMenu } from "./SubscriptionModelMenu";
const mocks = vi.hoisted(() => ({
  connected: false,
  pro: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
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
  mocks.connected = false;
  mocks.pro = true;
});
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
          <SubscriptionModelMenu />
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
  expect(screen.getByText("25% used")).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Disconnect ChatGPT" }),
  ).toBeVisible();
});
it("requires Dyad Pro before connection", async () => {
  mocks.pro = false;
  await open();
  expect(
    await screen.findByRole("menuitem", { name: "Connect with ChatGPT" }),
  ).toHaveAttribute("aria-disabled", "true");
});
