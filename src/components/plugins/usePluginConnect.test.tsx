import { createStore, Provider } from "jotai";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { McpListToolsResult, McpServer } from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  listTools: vi.fn(),
  getToolConsents: vi.fn(),
  probeConnection: vi.fn(),
  updateServer: vi.fn(),
  listCatalog: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    mcp: {
      listServers: mocks.listServers,
      listTools: mocks.listTools,
      getToolConsents: mocks.getToolConsents,
      probeConnection: mocks.probeConnection,
      updateServer: mocks.updateServer,
      listCatalog: mocks.listCatalog,
    },
  },
}));

vi.mock("./AddPluginDialog", () => ({
  useOauthCallbackPort: () => 53682,
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

import { useMcp } from "@/hooks/useMcp";
import { usePluginConnect } from "./usePluginConnect";

const SERVER_ID = 7;

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: SERVER_ID,
    name: "GitHub",
    transport: "http",
    command: null,
    args: null,
    envJson: null,
    headersJson: null,
    url: "https://api.githubcopilot.com/mcp/",
    enabled: true,
    oauthEnabled: false,
    oauthConnected: false,
    oauthCallbackPort: null,
    oauthClientId: null,
    envUnreadable: false,
    headersUnreadable: false,
    // No catalog slug, so a 401 here reads as "enable OAuth".
    catalogSlug: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const UNAUTHORIZED: McpListToolsResult = { tools: [], status: "unauthorized" };
const AUTHORIZED: McpListToolsResult = {
  tools: [{ name: "list_repos", description: null }],
  status: "ok",
};

function renderConnect() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return renderHook(() => ({ connect: usePluginConnect(), mcp: useMcp() }), {
    wrapper,
  });
}

describe("usePluginConnect feedback ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listServers.mockResolvedValue([makeServer()]);
    mocks.getToolConsents.mockResolvedValue([]);
    mocks.listCatalog.mockResolvedValue({ entries: [] });
    mocks.updateServer.mockImplementation(async () => makeServer());
  });

  it("drops the auth alert once credentials make discovery succeed", async () => {
    // A manual HTTP server has no Headers field at creation, so the
    // post-create probe always runs before the token exists.
    mocks.listTools.mockResolvedValue(UNAUTHORIZED);
    mocks.probeConnection.mockResolvedValue({
      status: "unauthorized",
      error: "MCP HTTP Transport Error: POSTing to endpoint (HTTP 401)",
    });

    const { result } = renderConnect();
    await waitFor(() => expect(result.current.mcp.servers).toHaveLength(1));

    await act(async () => {
      await result.current.connect.onServerCreated(makeServer(), {
        wantsOAuth: false,
      });
    });

    // The probe reports the 401 immediately; the alert follows from
    // discovery.
    expect(mocks.showError).toHaveBeenCalledWith(
      "Server connection failed. This server requires authentication. Try enabling OAuth.",
    );
    await waitFor(() =>
      expect(result.current.connect.feedbackFor(makeServer())?.kind).toBe(
        "unauthorized",
      ),
    );

    // The user now saves a personal access token. Discovery starts
    // succeeding, so the alert must go with it.
    mocks.listTools.mockResolvedValue(AUTHORIZED);
    await act(async () => {
      await result.current.mcp.updateServer({
        id: SERVER_ID,
        headersJson: { Authorization: "Bearer ghp_example" },
      });
    });

    await waitFor(() =>
      expect(result.current.connect.feedbackFor(makeServer())).toBeNull(),
    );
    expect(result.current.mcp.statusByServer[SERVER_ID]).toBe("ok");
  });

  it("keeps the auth alert while discovery still reports a 401", async () => {
    mocks.listTools.mockResolvedValue(UNAUTHORIZED);
    mocks.probeConnection.mockResolvedValue({
      status: "unauthorized",
      error: "HTTP 401",
    });

    const { result } = renderConnect();
    await waitFor(() => expect(result.current.mcp.servers).toHaveLength(1));

    await act(async () => {
      await result.current.connect.onServerCreated(makeServer(), {
        wantsOAuth: false,
      });
    });

    // A wrong token still fails discovery, so the alert stays.
    await act(async () => {
      await result.current.mcp.updateServer({
        id: SERVER_ID,
        headersJson: { Authorization: "Bearer wrong" },
      });
    });

    await waitFor(() =>
      expect(result.current.connect.feedbackFor(makeServer())?.kind).toBe(
        "unauthorized",
      ),
    );
  });
});
