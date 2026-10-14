// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
const state = vi.hoisted(() => ({ servers: [] as Server[], fail: "" }));
vi.mock("node:http", async (original) => {
  const actual = await original<typeof import("node:http")>();
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args);
      state.servers.push(server);
      if (state.fail === "address")
        vi.spyOn(server, "address").mockReturnValue(null);
      return server;
    },
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (state.fail === "write")
        return Promise.reject(new Error("write failed"));
      return actual.writeFile(...args);
    },
  };
});
import { createDyadToolBridge } from "./tool_bridge";
afterEach(() => {
  for (const server of state.servers.splice(0)) server.close();
  vi.restoreAllMocks();
});
it.each(["address", "write"])(
  "closes the bound listener after %s setup failure",
  async (fail) => {
    state.fail = fail;
    await expect(
      createDyadToolBridge({
        tools: {},
        signal: new AbortController().signal,
        invoke: vi.fn(),
      }),
    ).rejects.toThrow();
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0].listening).toBe(false);
  },
);
