import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnectionRef } from "@/shared/mcp_connection_ref";

const mocks = vi.hoisted(() => ({
  servers: [] as Array<{
    connection: { serverId: number; appConfigId: number | null };
    pluginName: string;
    displayName: string;
    transport: string;
  }>,
  resolveMcpConnectionsForApp: vi.fn(),
  listToolsWithin: vi.fn(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("@/ipc/utils/mcp_app_scoping", () => ({
  resolveMcpConnectionsForApp: mocks.resolveMcpConnectionsForApp,
}));

vi.mock("@/ipc/utils/mcp_manager", () => {
  class McpListToolsTimeoutError extends Error {}
  return {
    MCP_LIST_TOOLS_TIMEOUT_MS: 10_000,
    McpListToolsTimeoutError,
    mcpManager: {
      getClient: vi.fn(),
      listToolsWithin: mocks.listToolsWithin,
    },
  };
});

vi.mock("@/ipc/utils/mcp_consent", () => ({
  requireMcpToolConsent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => mocks.settings),
}));

const { McpListToolsTimeoutError } = await import("@/ipc/utils/mcp_manager");
const { collectMcpToolDefs, getCachedMcpToolDefs, loadEnabledMcpServerTools } =
  await import("./mcp_type_defs");

function connection(id: number, name: string) {
  return {
    connection: { serverId: id, appConfigId: null },
    pluginName: name,
    displayName: name,
    transport: "http",
  };
}
const figma = connection(1, "Figma");
const stripe = connection(2, "Stripe");
const APP_ID = 7;
const stripeTools = {
  list_customers: { description: "List customers", inputSchema: {} },
};

describe("loadEnabledMcpServerTools", () => {
  beforeEach(() => {
    mocks.servers = [figma, stripe];
    mocks.resolveMcpConnectionsForApp.mockImplementation(
      async () => mocks.servers,
    );
    mocks.listToolsWithin.mockReset();
  });

  it("skips a server that times out, keeps the others, and warns the user", async () => {
    mocks.listToolsWithin.mockImplementation(async (ref: McpConnectionRef) => {
      if (ref.serverId === figma.connection.serverId)
        throw new McpListToolsTimeoutError(ref, 10_000);
      return stripeTools;
    });
    const onWarningMessage = vi.fn();

    const loaded = await loadEnabledMcpServerTools({
      appId: APP_ID,
      onWarningMessage,
    });

    expect(loaded).toEqual([{ server: stripe, tools: stripeTools }]);
    expect(onWarningMessage).toHaveBeenCalledTimes(1);
    expect(onWarningMessage).toHaveBeenCalledWith(
      "MCP server \"Figma\" didn't respond within 10s, so its tools weren't available for this response.",
    );
  });

  it("loads servers concurrently so one slow server doesn't delay the rest", async () => {
    let releaseFigma!: () => void;
    const started: McpConnectionRef[] = [];
    mocks.listToolsWithin.mockImplementation(async (ref: McpConnectionRef) => {
      started.push(ref);
      if (ref.serverId === figma.connection.serverId) {
        await new Promise<void>((resolve) => (releaseFigma = resolve));
        return {};
      }
      return stripeTools;
    });

    const loading = loadEnabledMcpServerTools({ appId: APP_ID });
    await vi.waitFor(() =>
      expect(started).toEqual([figma.connection, stripe.connection]),
    );
    releaseFigma();

    expect((await loading).map(({ server }) => server.connection)).toEqual([
      figma.connection,
      stripe.connection,
    ]);
  });

  it("passes the turn's abort signal through and stays quiet once stopped", async () => {
    const controller = new AbortController();
    mocks.listToolsWithin.mockImplementation(
      (_ref: McpConnectionRef, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const onWarningMessage = vi.fn();

    const loading = loadEnabledMcpServerTools({
      appId: APP_ID,
      abortSignal: controller.signal,
      onWarningMessage,
    });
    // Abort only once both servers are waiting on the forwarded signal, so
    // this fails if the signal is dropped on the way to listToolsWithin.
    await vi.waitFor(() => {
      expect(mocks.listToolsWithin).toHaveBeenCalledTimes(2);
    });
    for (const [, options] of mocks.listToolsWithin.mock.calls) {
      expect(options.signal).toBe(controller.signal);
    }
    controller.abort(new Error("stopped by user"));

    await expect(loading).resolves.toEqual([]);
    expect(onWarningMessage).not.toHaveBeenCalled();
  });

  it("does not warn for ordinary failures such as a missing OAuth connection", async () => {
    mocks.listToolsWithin.mockImplementation(async (ref: McpConnectionRef) => {
      if (ref.serverId === figma.connection.serverId)
        throw new Error("401 Unauthorized");
      return stripeTools;
    });
    const onWarningMessage = vi.fn();

    const loaded = await loadEnabledMcpServerTools({
      appId: APP_ID,
      onWarningMessage,
    });

    expect(loaded.map(({ server }) => server.connection)).toEqual([
      stripe.connection,
    ]);
    expect(onWarningMessage).not.toHaveBeenCalled();
  });
});

describe("collectMcpToolDefs", () => {
  beforeEach(() => {
    mocks.servers = [figma, stripe];
    mocks.resolveMcpConnectionsForApp.mockImplementation(
      async () => mocks.servers,
    );
    mocks.listToolsWithin.mockReset();
  });

  it("uses the configuration the chat's app uses, keyed by the plugin's name", async () => {
    mocks.servers = [
      {
        connection: { serverId: stripe.connection.serverId, appConfigId: 5 },
        pluginName: "Stripe",
        displayName: "Stripe (Test account)",
        transport: "http",
      },
    ];
    mocks.listToolsWithin.mockResolvedValue(stripeTools);

    const [def] = await collectMcpToolDefs({ appId: APP_ID });

    expect(mocks.resolveMcpConnectionsForApp).toHaveBeenCalledWith(APP_ID);
    expect(mocks.listToolsWithin).toHaveBeenCalledWith(
      { serverId: stripe.connection.serverId, appConfigId: 5 },
      expect.anything(),
    );
    expect(def).toMatchObject({
      toolKey: "Stripe__list_customers",
      connection: { serverId: stripe.connection.serverId, appConfigId: 5 },
      serverName: "Stripe",
      displayName: "Stripe (Test account)",
    });
  });

  it("builds defs from the servers that answered", async () => {
    mocks.listToolsWithin.mockImplementation(async (ref: McpConnectionRef) => {
      if (ref.serverId === figma.connection.serverId)
        throw new McpListToolsTimeoutError(ref, 10_000);
      return stripeTools;
    });

    const defs = await collectMcpToolDefs({ appId: APP_ID });

    expect(defs.map((d) => d.toolKey)).toEqual(["Stripe__list_customers"]);
  });

  it("keeps the last complete cache when the turn is stopped mid-load", async () => {
    mocks.listToolsWithin.mockResolvedValue(stripeTools);
    await collectMcpToolDefs({ appId: APP_ID });
    const complete = getCachedMcpToolDefs(APP_ID);
    expect(complete).toHaveLength(2);

    const controller = new AbortController();
    mocks.listToolsWithin.mockImplementation(
      (_ref: McpConnectionRef, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const loading = collectMcpToolDefs({
      appId: APP_ID,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(mocks.listToolsWithin).toHaveBeenCalledTimes(4);
    });
    controller.abort(new Error("stopped by user"));

    await expect(loading).resolves.toEqual([]);
    expect(getCachedMcpToolDefs(APP_ID)).toEqual(complete);
  });

  it("gives no cached tools to an app that hasn't loaded any", async () => {
    mocks.settings = { enableAppScopedPlugins: true };
    mocks.listToolsWithin.mockResolvedValue(stripeTools);
    await collectMcpToolDefs({ appId: APP_ID });

    expect(getCachedMcpToolDefs(APP_ID)).toHaveLength(2);
    expect(getCachedMcpToolDefs(APP_ID + 100)).toEqual([]);
  });

  it("shares the latest tools with every app while the experiment is off", async () => {
    mocks.settings = {};
    mocks.listToolsWithin.mockResolvedValue(stripeTools);
    await collectMcpToolDefs({ appId: APP_ID });

    // Every app has the same plugins, so an app with no turn yet still
    // gets an estimate.
    expect(getCachedMcpToolDefs(APP_ID + 100)).toHaveLength(2);
  });

  it("keeps each app's tools when another app loads", async () => {
    mocks.settings = { enableAppScopedPlugins: true };
    mocks.listToolsWithin.mockResolvedValue(stripeTools);
    await collectMcpToolDefs({ appId: APP_ID });
    await collectMcpToolDefs({ appId: APP_ID + 1 });

    expect(getCachedMcpToolDefs(APP_ID)).toHaveLength(2);
    expect(getCachedMcpToolDefs(APP_ID + 1)).toHaveLength(2);
  });
});
