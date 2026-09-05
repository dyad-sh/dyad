// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFile, mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClaudeBridge, isClaudeFileRequestInApp } from "./bridge";

it("rejects traversal, out-of-app targets and symlink escapes before approving built-ins", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-paths-"));
  const app = path.join(root, "app");
  await mkdir(app);
  try {
    expect(
      await isClaudeFileRequestInApp(app, "Write", { file_path: "src/new.ts" }),
    ).toBe(true);
    expect(
      await isClaudeFileRequestInApp(app, "Read", { file_path: "../secret" }),
    ).toBe(false);
    expect(
      await isClaudeFileRequestInApp(app, "Write", {
        file_path: path.join(root, "secret"),
      }),
    ).toBe(false);
    expect(
      await isClaudeFileRequestInApp(app, "Glob", { pattern: "../**" }),
    ).toBe(false);
    expect(await isClaudeFileRequestInApp(app, "Grep", { path: root })).toBe(
      false,
    );
    if (process.platform !== "win32") {
      await symlink(root, path.join(app, "escape"));
      expect(
        await isClaudeFileRequestInApp(app, "Write", {
          file_path: "escape/secret",
        }),
      ).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("app-bound MCP bridge", () => {
  it("denies unauthenticated callers, unavailable tools, mutation in Ask, and extra arguments", async () => {
    const diagnostics = vi.fn(async () => ({ healthy: true }));
    const dependencies = vi.fn(async () => ({}));
    const bridge = await createClaudeBridge({
      appPath: process.cwd(),
      readOnly: true,
      signal: new AbortController().signal,
      approve: async () => true,
      diagnostics,
      dependencies,
      checks: async () => ({}),
      tests: async () => ({}),
      restart: async () => ({}),
      onTool: async () => {},
    });
    const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
      .mcpServers.dyad;
    const client = new Client({ name: "test", version: "1" });
    try {
      expect((await fetch(config.url, { method: "POST" })).status).toBe(403);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        }),
      );
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
        "permission",
        "diagnostics",
      ]);
      expect(
        (
          await client.callTool({
            name: "install_dependencies",
            arguments: { packages: ["example"] },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await client.callTool({
            name: "diagnostics",
            arguments: { appId: 99 },
          })
        ).isError,
      ).toBe(true);
      expect(
        (await client.callTool({ name: "diagnostics", arguments: {} })).isError,
      ).not.toBe(true);
      expect(diagnostics).toHaveBeenCalledOnce();
      expect(dependencies).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await bridge.close();
    }
  });
});
