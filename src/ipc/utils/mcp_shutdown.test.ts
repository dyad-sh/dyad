// @vitest-environment node

import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disposeAll: vi.fn<() => Promise<void>>(),
}));

vi.mock("./mcp_manager", () => ({
  mcpManager: {
    disposeAll: mocks.disposeAll,
  },
}));

const { disposeMcpClientsForShutdown } = await import("./mcp_shutdown");

it("starts MCP shutdown cleanup exactly once", async () => {
  const cleanup = Promise.resolve();
  mocks.disposeAll.mockReturnValue(cleanup);

  const first = disposeMcpClientsForShutdown();
  const second = disposeMcpClientsForShutdown();

  expect(first).toBe(cleanup);
  expect(second).toBe(cleanup);
  expect(mocks.disposeAll).toHaveBeenCalledTimes(1);
  await expect(first).resolves.toBeUndefined();
});
