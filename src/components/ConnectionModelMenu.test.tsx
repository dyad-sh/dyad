import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      getCodexSubscriptionStatus: mocks.status,
      connectCodexSubscription: mocks.connect,
      disconnectCodexSubscription: mocks.disconnect,
      retryCodexSubscriptionUsage: mocks.retry,
    },
  },
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenuSub: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuSubTrigger: Container,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      ...props
    }: React.ComponentProps<"button">) => (
      <button {...props}>{children}</button>
    ),
  };
});
import { ConnectionModelMenu } from "./ConnectionModelMenu";

function setup() {
  const onSelect = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ConnectionModelMenu
        open
        selected={{ provider: "openai", name: "gpt-test" }}
        modelsByProviders={{
          openai: [{ apiName: "gpt-test", displayName: "Test model" }],
        }}
        providers={[
          { id: "openai", name: "OpenAI", gatewayPrefix: "", type: "cloud" },
        ]}
        proEnabled
        isProviderSetup={() => true}
        onSelect={onSelect}
        onSetup={vi.fn()}
        onUpgrade={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onSelect, ...view };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({
    connected: true,
    pending: false,
    pendingReports: 0,
    chargedUsd: 0,
    missingUsage: false,
  });
});
describe("connection selection", () => {
  it("exposes all three billing sources and allows continuation with an explicit selection", async () => {
    const { onSelect } = setup();
    await screen.findByText("Disconnect ChatGPT");
    expect(screen.getByText("Subscription")).toBeTruthy();
    expect(screen.getByText("Pro credits")).toBeTruthy();
    expect(screen.getByText("API key")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Test model" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    expect(onSelect.mock.calls.map(([model]) => model.connection)).toEqual([
      "subscription",
      "pro",
      "api-key",
    ]);
    expect(screen.queryByText("Start new chat")).toBeNull();
  });
  it("requires explicit charge acceptance before starting browser authentication", async () => {
    mocks.status.mockResolvedValue({
      connected: false,
      pending: false,
      pendingReports: 0,
      chargedUsd: 0,
      missingUsage: false,
    });
    setup();
    const connect = await screen.findByText(
      "Agree to charges and connect ChatGPT",
    );
    await waitFor(() => expect(connect.hasAttribute("disabled")).toBe(false));
    fireEvent.click(connect);
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ acceptCharges: true }),
    );
    expect(screen.getByText(/25% of API list token pricing/)).toBeTruthy();
  });
  it("shows pending billing and retries without changing the model", async () => {
    mocks.status.mockResolvedValue({
      connected: true,
      pending: false,
      pendingReports: 1,
      chargedUsd: 0,
      missingUsage: false,
    });
    const { onSelect } = setup();
    fireEvent.click(await screen.findByText("Retry usage reporting"));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
