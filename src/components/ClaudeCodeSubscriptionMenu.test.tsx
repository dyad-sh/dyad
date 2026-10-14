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

async function open(connected = true, fail = false, enabled = true) {
  const enablement = fail
    ? vi.fn().mockRejectedValue(new Error("Could not enable subscription"))
    : vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DropdownMenu>
        <DropdownMenuTrigger>Models</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ClaudeCodeSubscriptionMenu
            enabled={enabled}
            onEnabledChange={enablement}
            connected={connected}
            detail="CLI connection details"
            onRefresh={refresh}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Models" }));
  expect(screen.queryByText("CLI connection details")).not.toBeInTheDocument();
  const trigger = screen.getByRole("menuitem", {
    name: "Claude Code subscription. Experimental. Open submenu.",
  });
  expect(trigger.querySelector("svg")).not.toBeNull();
  expect(trigger).toHaveTextContent("Experimental");
  await user.click(trigger);
  await screen.findByRole("menuitemcheckbox", {
    name: "Use Claude subscription",
  });
  expect(screen.getAllByText("Experimental")).toHaveLength(1);
  return { user, refresh, enablement };
}

it.each([true, false])(
  "toggles subscription enablement from %s without closing",
  async (enabled) => {
    const { user, enablement } = await open(true, false, enabled);
    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Use Claude subscription",
    });
    expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    if (!enabled) {
      expect(
        screen.queryByText("CLI connection details"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Claude usage details"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Refresh connection")).not.toBeInTheDocument();
    }
    await user.click(toggle);
    await waitFor(() => expect(enablement).toHaveBeenCalledWith(!enabled));
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  },
);

it("shows a failed enablement update", async () => {
  const { user } = await open(true, true, false);
  await user.click(
    screen.getByRole("menuitemcheckbox", {
      name: "Use Claude subscription",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not enable subscription",
  );
});

it("opens the branded submenu, displays usage, and refreshes without closing", async () => {
  const { user, refresh } = await open();
  expect(screen.getByText("Claude usage details")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh connection" }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.queryByText("CLI connection details")).not.toBeInTheDocument();
});

it("keeps disconnect instructions and allows disabling subscription usage", async () => {
  const { user, enablement } = await open(false);
  expect(screen.getByText("CLI connection details")).toBeInTheDocument();
  expect(screen.queryByText("Claude usage details")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Use Claude subscription" }),
  );
  await waitFor(() => expect(enablement).toHaveBeenCalledWith(false));
});

it("keeps billing explanations out of the menu body", async () => {
  await open();
  expect(
    screen.queryByText(/Claude subscription limits apply/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Subscription billing details" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Use API / Pro models")).not.toBeInTheDocument();
});
