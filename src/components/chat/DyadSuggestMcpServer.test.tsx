import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { DyadSuggestMcpServer } from "./DyadSuggestMcpServer";
import { DyadMessageIdContext } from "./messageContext";

const mocks = vi.hoisted(() => ({
  pending: new Map<number, unknown>(),
  respond: vi.fn(async () => true),
  addFromCatalog: vi.fn(),
  probeConnection: vi.fn(),
  connectNewServer: vi.fn(),
  connectingServerId: null as number | null,
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

vi.mock("@/components/plugins/usePluginConnect", () => ({
  usePluginConnect: () => ({
    connectNewServer: mocks.connectNewServer,
    connectingServerId: mocks.connectingServerId,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    mcp: {
      addFromCatalog: mocks.addFromCatalog,
      probeConnection: mocks.probeConnection,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
}));

const MESSAGE_ID = 5;
const PENDING = {
  chatId: 7,
  requestId: "mcp-suggestion:1",
  messageId: MESSAGE_ID,
  slug: "vercel",
  serverName: "Vercel",
  serverDescription: "Deployments and logs.",
  oauthRequired: false,
  reason: "Read the build logs for the failed deploy.",
  isResponding: false,
};
const CREATED = { id: 42, oauthEnabled: false, oauthCallbackPort: null };

function renderCard(
  props: Partial<Parameters<typeof DyadSuggestMcpServer>[0]> = {},
  messageId: number | undefined = MESSAGE_ID,
) {
  const store = createStore();
  store.set(selectedChatIdAtom, 7);
  const queryClient = new QueryClient();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <DyadMessageIdContext.Provider value={messageId}>
          {children}
        </DyadMessageIdContext.Provider>
      </Provider>
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

const connectButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Connect Vercel" });

describe("DyadSuggestMcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pending = new Map([[7, PENDING]]);
    mocks.connectingServerId = null;
    mocks.addFromCatalog.mockResolvedValue(CREATED);
    mocks.probeConnection.mockResolvedValue({ status: "ok", error: null });
    mocks.connectNewServer.mockResolvedValue(true);
  });

  it("shows the agent's reason with one-click connect and decline", () => {
    renderCard();

    expect(screen.getByText("Connect Vercel?")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    expect(screen.getByText("Deployments and logs.")).toBeTruthy();
    expect(connectButton().disabled).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Not now" })
        .disabled,
    ).toBe(false);
  });

  it("adds the plugin, probes it, and reports the connection without OAuth", async () => {
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("mcp-suggestion:1", {
        kind: "mcp-suggestion",
        outcome: "connected",
      }),
    );
    expect(mocks.addFromCatalog).toHaveBeenCalledWith({ slug: "vercel" });
    expect(mocks.probeConnection).toHaveBeenCalledWith(42);
    expect(mocks.connectNewServer).not.toHaveBeenCalled();
  });

  it("does not report a plugin whose server is unreachable", async () => {
    mocks.probeConnection.mockResolvedValue({
      status: "error",
      error: "connect ECONNREFUSED",
    });
    renderCard();

    fireEvent.click(connectButton());

    // Localized headline first, raw transport text as detail.
    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith(
        "suggestMcpServer.unreachable\nconnect ECONNREFUSED",
      ),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(connectButton().disabled).toBe(false);
  });

  it("tells the user to authorize when the probe is rejected with 401", async () => {
    mocks.probeConnection.mockResolvedValue({
      status: "unauthorized",
      error: "HTTP 401",
    });
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith(
        "suggestMcpServer.authRequired\nHTTP 401",
      ),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("runs the shared OAuth flow to completion before responding", async () => {
    mocks.pending = new Map([[7, { ...PENDING, oauthRequired: true }]]);
    let finishOAuth!: (connected: boolean) => void;
    mocks.connectNewServer.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishOAuth = resolve;
      }),
    );
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() =>
      expect(mocks.connectNewServer).toHaveBeenCalledWith(CREATED),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(mocks.probeConnection).not.toHaveBeenCalled();

    finishOAuth(true);
    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("mcp-suggestion:1", {
        kind: "mcp-suggestion",
        outcome: "connected",
      }),
    );
    // An authorized plugin is probed too before the agent resumes.
    expect(mocks.probeConnection).toHaveBeenCalledWith(42);
  });

  it("keeps the card interactive when OAuth fails", async () => {
    mocks.pending = new Map([[7, { ...PENDING, oauthRequired: true }]]);
    mocks.connectNewServer.mockResolvedValue(false);
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() => expect(mocks.connectNewServer).toHaveBeenCalled());
    await waitFor(() => expect(connectButton().disabled).toBe(false));
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("disables both buttons while another connect flow holds the slot", () => {
    mocks.connectingServerId = 3;
    renderCard();

    expect(connectButton().disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Not now" })
        .disabled,
    ).toBe(true);
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

  it("renders terminal outcomes with the reason from the persisted card", () => {
    mocks.pending = new Map();

    const { unmount } = renderCard({ name: "Vercel", outcome: "connected" });
    expect(screen.getByText("Vercel connected")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    unmount();

    renderCard({ name: "Vercel", outcome: "declined" });
    expect(screen.getByText("Skipped Vercel")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
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

  it("treats a same-plugin card from an earlier message as historical", () => {
    const { container } = renderCard({}, MESSAGE_ID - 1);
    expect(container.innerHTML).toBe("");
  });

  it("treats a same-plugin card with a different reason as historical", () => {
    const { container } = renderCard({ reason: "Check the domain." });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a dismissed card even while a request is live", () => {
    const { container } = renderCard({ outcome: "dismissed" });
    expect(container.innerHTML).toBe("");
  });

  it("falls back to matching the plugin when rendered outside a message", () => {
    renderCard({}, undefined);
    expect(screen.getByText("Connect Vercel?")).toBeTruthy();
  });
});
