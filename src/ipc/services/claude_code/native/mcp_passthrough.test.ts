import { describe, expect, it } from "vitest";
import { toPassthroughServer } from "./mcp_passthrough";

const row = {
  name: "Linear",
  transport: "stdio",
  command: "npx",
  args: ["-y", "linear-mcp"],
  url: null,
  envEncrypted: null,
  envJson: { LINEAR_KEY: "secret" },
  headersEncrypted: null,
  headersJson: null,
  oauthEnabled: false,
};
const plain = ((_: unknown, value: Record<string, string> | null) => ({
  status: "ok" as const,
  value: value ?? null,
})) as never;

describe("toPassthroughServer", () => {
  it("passes stdio servers with their environment", () => {
    expect(toPassthroughServer(row, plain)).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "linear-mcp"],
      env: { LINEAR_KEY: "secret" },
    });
  });

  it("passes http servers with their headers", () => {
    expect(
      toPassthroughServer(
        {
          ...row,
          transport: "http",
          command: null,
          url: "https://mcp.example.com",
          envJson: null,
          headersJson: { Authorization: "Bearer x" },
        },
        plain,
      ),
    ).toEqual({
      type: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("keeps OAuth servers on Dyad's bridge", () => {
    expect(toPassthroughServer({ ...row, oauthEnabled: true }, plain)).toBe(
      "proxy",
    );
  });

  it("never passes a server whose secrets cannot be read", () => {
    const unreadable = (() => ({ status: "unreadable" })) as never;
    expect(toPassthroughServer(row, unreadable)).toEqual({
      warning: expect.stringContaining("Linear"),
    });
  });
});
