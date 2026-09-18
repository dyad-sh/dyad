import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fetch } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createDyadToolBridge } from "./tool_bridge";
import {
  TOOL_DEFINITIONS,
  buildAgentToolSet,
  shouldIncludeTool,
} from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";

it("adapts every registered schema plus dynamic third-party tools without a Claude catalog", async () => {
  const tools = Object.fromEntries(
    TOOL_DEFINITIONS.map((t) => [
      t.name,
      { inputSchema: t.inputSchema, description: t.description },
    ]),
  );
  tools.external_server__custom = {
    inputSchema: z.object({ query: z.string() }),
    description: "Third-party tool",
  };
  const bridge = await createDyadToolBridge({
    tools,
    signal: new AbortController().signal,
    invoke: vi.fn(),
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const client = new Client({ name: "registry-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        fetch: fetch as unknown as typeof globalThis.fetch,
        requestInit: { headers: config.headers },
      }),
    );
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
      Object.keys(tools).sort(),
    );
  } finally {
    await client.close();
    await bridge.close();
  }
});

it("uses the same availability rules for Build, Ask, Plan, provider and feature profiles", () => {
  const ctx = {
    isDyadPro: true,
    frameworkType: "vite",
    referencedApps: new Map(),
    supabaseProjectId: null,
    neonProjectId: null,
    canUseExplorerSubagent: true,
    canUseImplementerSubagent: true,
    testingEnabled: true,
    preCommitHookAvailable: true,
  } as unknown as AgentContext;
  for (const options of [
    { toolProfile: "build" as const },
    { readOnly: true },
    { planModeOnly: true },
    { freeModelMode: true },
    { basicAgentMode: true },
    {},
  ]) {
    expect(Object.keys(buildAgentToolSet(ctx, options)).sort()).toEqual(
      TOOL_DEFINITIONS.filter((t) => shouldIncludeTool(t, ctx, options))
        .map((t) => t.name)
        .sort(),
    );
  }
  expect(buildAgentToolSet(ctx, { planModeOnly: true })).not.toHaveProperty(
    "write_file",
  );
  expect(buildAgentToolSet(ctx, { planModeOnly: true })).toHaveProperty(
    "write_plan",
  );
});

it("deduplicates retried MCP identities and rejects conflicting payloads and foreign origins", async () => {
  const invoke = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "done" }],
  }));
  const bridge = await createDyadToolBridge({
    tools: { probe: { inputSchema: z.object({ text: z.string() }) } },
    signal: new AbortController().signal,
    invoke,
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const call = (text: string, origin?: string) =>
    fetch(config.url, {
      method: "POST",
      headers: {
        ...config.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "probe", arguments: { text } },
      }),
    });
  try {
    const responses = await Promise.all([call("same"), call("same")]);
    await Promise.all(responses.map((r) => r.text()));
    expect(invoke).toHaveBeenCalledOnce();
    expect(await (await call("different")).text()).toContain(
      "Conflicting MCP retry identity",
    );
    expect((await call("same", "https://untrusted.example")).status).toBe(403);
    expect(invoke).toHaveBeenCalledOnce();
  } finally {
    await bridge.close();
  }
});
