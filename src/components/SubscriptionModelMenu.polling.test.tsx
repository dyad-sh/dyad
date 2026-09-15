import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SubscriptionModelMenu } from "./SubscriptionModelMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const { account } = vi.hoisted(() => ({
  account: vi.fn((_open: boolean) => ({ data: { connected: false } })),
}));
vi.mock("@/hooks/useSubscriptionAccount", () => ({
  useSubscriptionAccount: account,
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: undefined }),
}));
vi.mock("@/ipc/types", () => ({ ipc: { settings: {} } }));
afterEach(cleanup);

it("enables usage polling only while the subscription submenu is open", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <DropdownMenu>
        <DropdownMenuTrigger>Models</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SubscriptionModelMenu />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Models" }));
  expect(account).toHaveBeenLastCalledWith(false);
  await user.hover(
    screen.getByRole("menuitem", { name: /Subscription.*Open submenu/ }),
  );
  await waitFor(() => expect(account).toHaveBeenLastCalledWith(true));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(account).toHaveBeenLastCalledWith(false));
  client.clear();
});
