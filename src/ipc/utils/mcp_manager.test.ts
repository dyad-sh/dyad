// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPClient } from "@ai-sdk/mcp";

const mocks = vi.hoisted(() => ({
  rows: new Map<number, Record<string, unknown>>(),
  select: vi.fn(),
  createMCPClient: vi.fn(),
  stdioOptions: [] as unknown[],
}));

vi.mock("../../db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("../../db/schema", () => ({
  mcpServers: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: number) => value,
}));

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: mocks.createMCPClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(options: unknown) {
      mocks.stdioOptions.push(options);
    }
  },
}));

vi.mock("./mcp_oauth_provider", () => ({
  DyadOAuthClientProvider: class {},
  decryptFromString: vi.fn((value: string) => value),
}));

const { McpManager } = await import("./mcp_manager");

function seedStdioServer(id: number): void {
  mocks.rows.set(id, {
    id,
    transport: "stdio",
    command: "test-mcp-server",
    args: ["--stdio"],
    envJson: { TEST_MCP: "true" },
  });
}

function createClient(
  close: () => Promise<void> = vi.fn(async () => {}),
): MCPClient {
  return { close } as MCPClient;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("McpManager lifecycle", () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.createMCPClient.mockReset();
    mocks.stdioOptions.length = 0;
    mocks.select.mockReset();
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: async () => [...mocks.rows.values()],
      }),
    }));
  });

  it("coalesces simultaneous client initialization into one stdio launch", async () => {
    seedStdioServer(1);
    const pendingClient = deferred<MCPClient>();
    const client = createClient();
    mocks.createMCPClient.mockReturnValueOnce(pendingClient.promise);
    const manager = new McpManager();

    const first = manager.getClient(1);
    const second = manager.getClient(1);

    await vi.waitFor(() => {
      expect(mocks.createMCPClient).toHaveBeenCalledTimes(1);
    });
    expect(mocks.stdioOptions).toHaveLength(1);

    pendingClient.resolve(client);
    await expect(first).resolves.toBe(client);
    await expect(second).resolves.toBe(client);
  });

  it("removes a failed initialization so the next request can retry", async () => {
    seedStdioServer(2);
    const client = createClient();
    mocks.createMCPClient
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValueOnce(client);
    const manager = new McpManager();

    await expect(manager.getClient(2)).rejects.toThrow("launch failed");
    await expect(manager.getClient(2)).resolves.toBe(client);

    expect(mocks.createMCPClient).toHaveBeenCalledTimes(2);
    expect(mocks.stdioOptions).toHaveLength(2);
  });

  it("closes and rejects a client whose initialization is disposed", async () => {
    seedStdioServer(3);
    const pendingClient = deferred<MCPClient>();
    const close = vi.fn(async () => {});
    const client = createClient(close);
    const replacement = createClient();
    mocks.createMCPClient
      .mockReturnValueOnce(pendingClient.promise)
      .mockResolvedValueOnce(replacement);
    const manager = new McpManager();

    const initializationResult = manager.getClient(3).catch((error) => error);
    await vi.waitFor(() => {
      expect(mocks.createMCPClient).toHaveBeenCalledTimes(1);
    });

    const disposal = manager.dispose(3);
    pendingClient.resolve(client);

    await expect(disposal).resolves.toBeUndefined();
    await expect(initializationResult).resolves.toMatchObject({
      message: "MCP client initialization cancelled for server 3",
    });
    expect(close).toHaveBeenCalledTimes(1);
    await expect(manager.getClient(3)).resolves.toBe(replacement);
  });

  it("disposes one server without disturbing other cached clients", async () => {
    seedStdioServer(4);
    seedStdioServer(5);
    const firstClose = vi.fn(async () => {});
    const first = createClient(firstClose);
    const second = createClient();
    const replacement = createClient();
    mocks.createMCPClient
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(replacement);
    const manager = new McpManager();

    await manager.getClient(4);
    await manager.getClient(5);
    const firstDisposal = manager.dispose(4);
    const duplicateDisposal = manager.dispose(4);

    expect(duplicateDisposal).toBe(firstDisposal);
    await expect(firstDisposal).resolves.toBeUndefined();
    expect(firstClose).toHaveBeenCalledTimes(1);
    await expect(manager.getClient(5)).resolves.toBe(second);
    await expect(manager.getClient(4)).resolves.toBe(replacement);
    expect(mocks.createMCPClient).toHaveBeenCalledTimes(3);
  });

  it("settles every close during disposeAll even when one close fails", async () => {
    seedStdioServer(6);
    seedStdioServer(7);
    const failingClose = vi.fn(async () => {
      throw new Error("transport already exited");
    });
    const successfulClose = vi.fn(async () => {});
    mocks.createMCPClient
      .mockResolvedValueOnce(createClient(failingClose))
      .mockResolvedValueOnce(createClient(successfulClose));
    const manager = new McpManager();

    await manager.getClient(6);
    await manager.getClient(7);

    await expect(manager.disposeAll()).resolves.toBeUndefined();
    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(successfulClose).toHaveBeenCalledTimes(1);

    await expect(manager.disposeAll()).resolves.toBeUndefined();
    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(successfulClose).toHaveBeenCalledTimes(1);
  });
});
