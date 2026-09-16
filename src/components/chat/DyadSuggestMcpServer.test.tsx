import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { DyadSuggestMcpServer } from "./DyadSuggestMcpServer";

const mocks = vi.hoisted(() => ({
  pending: new Map<number, unknown>(),
  respond: vi.fn(async () => true),
  addFromCatalog: vi.fn(),
  startOAuth: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      switch (key) {
        case "suggestMcpServer.badge":
          return "Plugin suggestion";
        case "suggestMcpServer.title":
          return `Connect ${values?.name}?`;
        case "suggestMcpServer.connect":
          return `Connect ${values?.name}`;
        case "suggestMcpServer.notNow":
          return "Not now";
        case "suggestMcpServer.connectedTitle":
          return `${values?.name} connected`;
        case "suggestMcpServer.declinedTitle":
          return `Skipped ${values?.name}`;
        default:
          return key;
      }
    },
  }),
}));

vi.mock("@/user_input/hooks", () => ({
  usePendingMcpSuggestions: () => mocks.pending,
  useUserInputReadModel: () => ({ respond: mocks.respond }),
}));

vi.mock("@/components/plugins/AddPluginDialog", () => ({
  useOauthCallbackPort: () => 51234,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    mcp: {
      addFromCatalog: mocks.addFromCatalog,
      startOAuth: mocks.startOAuth,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
}));

const PENDING = {
  chatId: 7,
  requestId: "mcp-suggestion:1",
  slug: "vercel",
  serverName: "Vercel",
  serverDescription: "Deployments and logs.",
  reason: "Read the build logs for the failed deploy.",
  isResponding: false,
};

function renderCard(
  props: Partial<Parameters<typeof DyadSuggestMcpServer>[0]> = {},
) {
  const store = createStore();
  store.set(selectedChatIdAtom, 7);
  const queryClient = new QueryClient();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return render(
    <DyadSuggestMcpServer
      slug="vercel"
      reason={PENDING.reason}
      outcome="pending"
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

describe("DyadSuggestMcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pending = new Map([[7, PENDING]]);
    mocks.addFromCatalog.mockResolvedValue({
      id: 42,
      oauthEnabled: false,
      oauthCallbackPort: null,
    });
    mocks.startOAuth.mockResolvedValue({ success: true, error: null });
  });

  it("shows the agent's reason with one-click connect and decline", () => {
    renderCard();

    expect(screen.getByText("Connect Vercel?")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    expect(screen.getByText("Deployments and logs.")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Connect Vercel" })
        .disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Not now" })
        .disabled,
    ).toBe(false);
  });

  it("adds the plugin and reports the connection without OAuth", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Connect Vercel" }));

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("mcp-suggestion:1", {
        kind: "mcp-suggestion",
        outcome: "connected",
      }),
    );
    expect(mocks.addFromCatalog).toHaveBeenCalledWith({ slug: "vercel" });
    expect(mocks.startOAuth).not.toHaveBeenCalled();
  });

  it("runs the OAuth flow for OAuth-enabled plugins before responding", async () => {
    mocks.addFromCatalog.mockResolvedValue({
      id: 42,
      oauthEnabled: true,
      oauthCallbackPort: null,
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Connect Vercel" }));

    await waitFor(() => expect(mocks.respond).toHaveBeenCalled());
    expect(mocks.startOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 42, callbackPort: 51234 }),
    );
  });

  it("keeps the card interactive when OAuth fails", async () => {
    mocks.addFromCatalog.mockResolvedValue({
      id: 42,
      oauthEnabled: true,
      oauthCallbackPort: null,
    });
    mocks.startOAuth.mockResolvedValue({ success: false, error: "Denied" });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Connect Vercel" }));

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith("Denied"));
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Connect Vercel" })
        .disabled,
    ).toBe(false);
  });

  it("declines without adding anything", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("mcp-suggestion:1", {
        kind: "mcp-suggestion",
        outcome: "declined",
      }),
    );
    expect(mocks.addFromCatalog).not.toHaveBeenCalled();
  });

  it("renders terminal outcomes from the persisted card alone", () => {
    mocks.pending = new Map();

    const { unmount } = renderCard({ name: "Vercel", outcome: "connected" });
    expect(screen.getByText("Vercel connected")).toBeTruthy();
    unmount();

    renderCard({ name: "Vercel", outcome: "declined" });
    expect(screen.getByText("Skipped Vercel")).toBeTruthy();
  });

  it("hides a pending card whose request is no longer live", () => {
    mocks.pending = new Map();

    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
  });

  it("treats a pending request for another plugin as historical", () => {
    mocks.pending = new Map([
      [7, { ...PENDING, slug: "stripe", serverName: "Stripe" }],
    ]);

    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
  });
});
