import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/chat.json";
import { queryKeys } from "@/lib/queryKeys";
import {
  CLAUDE_CODE_UPDATE_URL,
  ClaudeCodeWorktreeBanner,
} from "./ClaudeCodeWorktreeBanner";

const mocks = vi.hoisted(() => ({
  settings: null as { enableWorktreeIsolation?: boolean } | null,
  status: vi.fn(),
  openExternalUrl: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: { claudeCodeStatus: mocks.status },
    system: { openExternalUrl: mocks.openExternalUrl },
  },
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version: string }) => {
      const copy =
        en.workspace[
          key.replace("workspace.", "") as keyof typeof en.workspace
        ];
      return copy.replace("{{version}}", options?.version ?? "");
    },
  }),
}));

function status(version: string | null) {
  return {
    installed: true,
    connected: true,
    // The banner must still show for CLIs rejected by the separate runtime minimum.
    compatible: false,
    version,
    detail: "Update the official CLI.",
  };
}

function setup() {
  const store = createStore();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const tree = (usesClaudeCode = true) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <ClaudeCodeWorktreeBanner usesClaudeCode={usesClaudeCode} />
      </Provider>
    </QueryClientProvider>
  );
  return { client, tree };
}

beforeEach(() => {
  mocks.settings = { enableWorktreeIsolation: true };
  mocks.status.mockReset().mockResolvedValue(status("2.1.18"));
  mocks.openExternalUrl.mockReset().mockResolvedValue(undefined);
  mocks.showError.mockReset();
});

it("explains the old CLI restriction and opens the update instructions", async () => {
  const { tree } = setup();
  render(tree());
  const banner = await screen.findByTestId("claude-code-worktree-banner");
  expect(banner.textContent).toContain(
    "Claude Code 2.1.18 cannot resume chats across worktrees",
  );
  fireEvent.click(screen.getByRole("button", { name: "How to update" }));
  expect(mocks.openExternalUrl).toHaveBeenCalledWith(CLAUDE_CODE_UPDATE_URL);
});

it.each(["2.1.19", "2.1.20", "2.1.281", "3.0.0", null, "unknown"])(
  "does not warn for a supported or unknown version: %s",
  async (version) => {
    mocks.status.mockResolvedValue(status(version));
    const { client, tree } = setup();
    render(tree());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
  },
);

it("waits for CLI status before showing a warning", async () => {
  let resolve!: (value: ReturnType<typeof status>) => void;
  mocks.status.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { tree } = setup();
  render(tree());
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
  await act(async () => resolve(status("2.1.18")));
  expect(await screen.findByTestId("claude-code-worktree-banner")).toBeTruthy();
});

it("hides cached warnings when isolation is off, settings are loading, or another model is selected", async () => {
  const { tree } = setup();
  const view = render(tree());
  await screen.findByTestId("claude-code-worktree-banner");
  mocks.settings = { enableWorktreeIsolation: false };
  view.rerender(tree());
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
  mocks.settings = null;
  view.rerender(tree());
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
  mocks.settings = { enableWorktreeIsolation: true };
  view.rerender(tree(false));
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
});

it("does not probe the CLI for chats using another backend", () => {
  const { tree } = setup();
  render(tree(false));
  expect(mocks.status).not.toHaveBeenCalled();
});

it("keeps dismissal across remounts for the same version", async () => {
  const { tree } = setup();
  const view = render(tree());
  await screen.findByTestId("claude-code-worktree-banner");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Dismiss Claude Code upgrade reminder",
    }),
  );
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
  view.unmount();
  render(tree());
  expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull();
});

it("removes the banner when refreshed status detects an upgrade", async () => {
  const { client, tree } = setup();
  render(tree());
  await screen.findByTestId("claude-code-worktree-banner");
  mocks.status.mockResolvedValue(status("2.1.281"));
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.system.claudeCodeStatus,
    });
  });
  await waitFor(() =>
    expect(screen.queryByTestId("claude-code-worktree-banner")).toBeNull(),
  );
});

it("reports a failed update link without an unhandled rejection", async () => {
  mocks.openExternalUrl.mockRejectedValue(new Error("Could not open browser"));
  const { tree } = setup();
  render(tree());
  await screen.findByTestId("claude-code-worktree-banner");
  fireEvent.click(screen.getByRole("button", { name: "How to update" }));
  await waitFor(() =>
    expect(mocks.showError).toHaveBeenCalledWith(
      en.workspace.claudeUpgradeLinkFailed,
    ),
  );
});
