import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "./ui/dropdown-menu";
import { ClaudeCodeSubscriptionMenu } from "./ClaudeCodeSubscriptionMenu";

vi.mock("./ClaudeCodeUsage", () => ({
  ClaudeCodeUsage: ({ open }: { open: boolean }) =>
    open ? <p>Claude usage details</p> : null,
}));

async function open(
  subscriptionSelected = true,
  connected = true,
  fail = false,
) {
  const usage = fail
    ? vi.fn().mockRejectedValue(new Error("Could not save usage preference"))
    : vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DropdownMenu>
        <DropdownMenuTrigger>Models</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ClaudeCodeSubscriptionMenu
            connected={connected}
            detail="CLI connection details"
            subscriptionSelected={subscriptionSelected}
            onUsageChange={usage}
            onRefresh={refresh}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Models" }));
  expect(screen.queryByText("CLI connection details")).not.toBeInTheDocument();
  const trigger = screen.getByRole("menuitem", {
    name: "Claude Code subscription. Open submenu.",
  });
  expect(trigger.querySelector("svg")).not.toBeNull();
  await user.click(trigger);
  await screen.findByText("CLI connection details");
  return { user, usage, refresh };
}

it("opens the branded submenu, displays usage, and refreshes without closing", async () => {
  const { user, refresh } = await open();
  expect(screen.getByText("Claude usage details")).toBeInTheDocument();
  await user.click(
    screen.getByRole("menuitem", { name: "Refresh connection" }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getByText("CLI connection details")).toBeInTheDocument();
});

it.each([true, false])(
  "changes the usage source when subscriptionSelected=%s",
  async (selected) => {
    const { user, usage } = await open(selected);
    await user.click(
      screen.getByRole("menuitem", {
        name: selected ? "Use API / Pro models" : "Use subscription models",
      }),
    );
    await waitFor(() =>
      expect(usage).toHaveBeenCalledWith(selected ? "pro" : "subscription"),
    );
  },
);

it("allows returning to API usage after the CLI disconnects", async () => {
  const { user, usage } = await open(true, false);
  expect(screen.queryByText("Claude usage details")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("menuitem", { name: "Use API / Pro models" }),
  );
  await waitFor(() => expect(usage).toHaveBeenCalled());
});

it("shows a failed preference update", async () => {
  const { user } = await open(true, true, true);
  await user.click(
    screen.getByRole("menuitem", { name: "Use API / Pro models" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save usage preference",
  );
});
