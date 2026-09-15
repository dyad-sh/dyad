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
    for (const file of [
      ".env",
      ".env.local",
      ".envrc",
      "nested/.env.production",
    ]) {
      expect(
        await isClaudeFileRequestInApp(app, "Read", { file_path: file }),
      ).toBe(false);
      expect(
        await isClaudeFileRequestInApp(app, "Edit", { file_path: file }),
      ).toBe(false);
    }
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

it("allows reference reads but never reference writes, even in writable mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-reference-"));
  const current = path.join(root, "current");
  const reference = path.join(root, "reference");
  await mkdir(current);
  await mkdir(reference);
  const approve = vi.fn(async () => true);
  const bridge = await createClaudeBridge({
    appPath: current,
    readOnlyPaths: [reference],
    readOnly: false,
    signal: new AbortController().signal,
    approve,
    diagnostics: async () => ({}),
    checks: async () => ({}),
    tests: async () => ({}),
    dependencies: async () => ({}),
    restart: async () => ({}),
    onTool: async () => {},
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    for (const [tool, expected] of [
      ["Read", "allow"],
      ["Write", "deny"],
      ["Edit", "deny"],
    ]) {
      const result = await client.callTool({
        name: "permission",
        arguments: {
          tool_name: tool,
          input: { file_path: path.join(reference, "file.ts") },
        },
      });
      expect(
        JSON.parse((result.content as { text: string }[])[0].text).behavior,
      ).toBe(expected);
    }
    const grep = await client.callTool({
      name: "permission",
      arguments: {
        tool_name: "Grep",
        input: { path: current, glob: ".env*", pattern: ".*" },
      },
    });
    expect(
      JSON.parse((grep.content as { text: string }[])[0].text).behavior,
    ).toBe("deny");
    expect(approve).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves large permission inputs and drains actual MCP work before closing", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dependencies = vi.fn(async () => {
    await blocked;
    return "installed";
  });
  const bridge = await createClaudeBridge({
    appPath: process.cwd(),
    readOnly: false,
    signal: new AbortController().signal,
    approve: async () => true,
    diagnostics: async () => ({}),
    checks: async () => ({}),
    tests: async () => ({}),
    dependencies,
    restart: async () => ({}),
    onTool: async () => {},
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    const input = {
      file_path: path.join(process.cwd(), "large-file.txt"),
      content: "x".repeat(50_000),
    };
    const result = await client.callTool({
      name: "permission",
      arguments: { tool_name: "Write", input },
    });
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
    const request = client
      .callTool({
        name: "install_dependencies",
        arguments: { packages: ["react"] },
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(dependencies).toHaveBeenCalledOnce());
    let closed = false;
    const closing = bridge.close().then(() => {
      closed = true;
    });
    // A dispatched HTTP request is already finished, but its operation is not.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(closed).toBe(false);
    release();
    await closing;
    await request;
    expect(closed).toBe(true);
  } finally {
    release();
    await client.close();
    await bridge.close();
  }
});
