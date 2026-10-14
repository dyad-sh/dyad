import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  servers: [] as Array<{ id: number; name: string; transport: string }>,
  listToolsWithin: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => mocks.servers,
      }),
    }),
  },
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
  readSettings: vi.fn(() => ({})),
}));

const { McpListToolsTimeoutError } = await import("@/ipc/utils/mcp_manager");
const { collectMcpToolDefs, getCachedMcpToolDefs, loadEnabledMcpServerTools } =
  await import("./mcp_type_defs");

const figma = { id: 1, name: "Figma", transport: "http" };
const stripe = { id: 2, name: "Stripe", transport: "http" };
const stripeTools = {
  list_customers: { description: "List customers", inputSchema: {} },
};

describe("loadEnabledMcpServerTools", () => {
  beforeEach(() => {
    mocks.servers = [figma, stripe];
    mocks.listToolsWithin.mockReset();
  });

  it("skips a server that times out, keeps the others, and warns the user", async () => {
    mocks.listToolsWithin.mockImplementation(async (serverId: number) => {
      if (serverId === figma.id)
        throw new McpListToolsTimeoutError(serverId, 10_000);
      return stripeTools;
    });
    const onWarningMessage = vi.fn();

    const loaded = await loadEnabledMcpServerTools({ onWarningMessage });

    expect(loaded).toEqual([{ server: stripe, tools: stripeTools }]);
    expect(onWarningMessage).toHaveBeenCalledTimes(1);
    expect(onWarningMessage).toHaveBeenCalledWith(
      "MCP server \"Figma\" didn't respond within 10s, so its tools weren't available for this response.",
    );
  });

  it("loads servers concurrently so one slow server doesn't delay the rest", async () => {
    let releaseFigma!: () => void;
    const started: number[] = [];
    mocks.listToolsWithin.mockImplementation(async (serverId: number) => {
      started.push(serverId);
      if (serverId === figma.id) {
        await new Promise<void>((resolve) => (releaseFigma = resolve));
        return {};
      }
      return stripeTools;
    });

    const loading = loadEnabledMcpServerTools();
    await vi.waitFor(() => expect(started).toEqual([figma.id, stripe.id]));
    releaseFigma();

    expect((await loading).map(({ server }) => server.id)).toEqual([
      figma.id,
      stripe.id,
    ]);
  });

  it("passes the turn's abort signal through and stays quiet once stopped", async () => {
    const controller = new AbortController();
    mocks.listToolsWithin.mockImplementation(
      (_serverId: number, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const onWarningMessage = vi.fn();

    const loading = loadEnabledMcpServerTools({
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
    mocks.listToolsWithin.mockImplementation(async (serverId: number) => {
      if (serverId === figma.id) throw new Error("401 Unauthorized");
      return stripeTools;
    });
    const onWarningMessage = vi.fn();

    const loaded = await loadEnabledMcpServerTools({ onWarningMessage });

    expect(loaded.map(({ server }) => server.id)).toEqual([stripe.id]);
    expect(onWarningMessage).not.toHaveBeenCalled();
  });
});

describe("collectMcpToolDefs", () => {
  beforeEach(() => {
    mocks.servers = [figma, stripe];
    mocks.listToolsWithin.mockReset();
  });

  it("builds defs from the servers that answered", async () => {
    mocks.listToolsWithin.mockImplementation(async (serverId: number) => {
      if (serverId === figma.id)
        throw new McpListToolsTimeoutError(serverId, 10_000);
      return stripeTools;
    });

    const defs = await collectMcpToolDefs();

    expect(defs.map((d) => d.toolKey)).toEqual(["Stripe__list_customers"]);
  });

  it("keeps the last complete cache when the turn is stopped mid-load", async () => {
    mocks.listToolsWithin.mockResolvedValue(stripeTools);
    await collectMcpToolDefs();
    const complete = getCachedMcpToolDefs();
    expect(complete).toHaveLength(2);

    const controller = new AbortController();
    mocks.listToolsWithin.mockImplementation(
      (_serverId: number, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const loading = collectMcpToolDefs({ abortSignal: controller.signal });
    await vi.waitFor(() => {
      expect(mocks.listToolsWithin).toHaveBeenCalledTimes(4);
    });
    controller.abort(new Error("stopped by user"));

    await expect(loading).resolves.toEqual([]);
    expect(getCachedMcpToolDefs()).toEqual(complete);
  });
});
