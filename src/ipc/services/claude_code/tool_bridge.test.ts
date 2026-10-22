import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fetch } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createDyadToolBridge } from "./tool_bridge";
import { CancellationReason } from "@/shared/cancellation_reason";
import {
  TOOL_DEFINITIONS,
  buildAgentToolSet,
  shouldIncludeTool,
} from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";

it("delivers progress on the tool POST while execution is still pending", async () => {
  // Advance only the heartbeat interval: leave real HTTP and SDK deadlines live.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => (finish = resolve));
  const invoke = vi.fn(async () => {
    await pending;
    return { content: [{ type: "text" as const, text: "completed once" }] };
  });
  const bridge = await createDyadToolBridge({
    tools: { slow: { inputSchema: z.object({}) } },
    signal: new AbortController().signal,
    invoke,
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const client = new Client({ name: "progress-test", version: "1" });
  let call: ReturnType<typeof client.callTool> | undefined;
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        fetch: fetch as unknown as typeof globalThis.fetch,
        requestInit: { headers: config.headers },
      }),
    );
    const onprogress = vi.fn();
    call = client.callTool({ name: "slow", arguments: {} }, undefined, {
      timeout: 10_000,
      onprogress,
      resetTimeoutOnProgress: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_000);
    // GET is forbidden by this stateless bridge. Progress must travel on the
    // original POST, before its final result; a standalone notification is lost.
    await vi.waitFor(() =>
      expect(onprogress).toHaveBeenCalledWith({
        progress: 1,
        message: "Waiting for Dyad tool completion",
      }),
    );
    finish();
    expect(await call).toMatchObject({ content: [{ text: "completed once" }] });
    expect(invoke).toHaveBeenCalledOnce();
  } finally {
    finish();
    await call?.catch(() => {});
    await client.close();
    await bridge.close();
    vi.useRealTimers();
  }
});

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

it("releases an in-flight call when the client cancels it from a later POST", async () => {
  let observed: AbortSignal | undefined;
  const invoke = vi.fn(async (_name, _args, _id, signal: AbortSignal) => {
    observed = signal;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { content: [{ type: "text" as const, text: "released" }] };
  });
  const bridge = await createDyadToolBridge({
    tools: { wait: { inputSchema: z.object({}) } },
    signal: new AbortController().signal,
    invoke,
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const post = (body: unknown) =>
    fetch(config.url, {
      method: "POST",
      headers: {
        ...config.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
  try {
    const call = post({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    await vi.waitFor(() => expect(observed).toBeDefined());
    expect(observed!.aborted).toBe(false);
    // Stateless transport: the cancellation arrives on its own POST, served by
    // a different MCP server instance than the call it names.
    const cancelled = await post({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 7, reason: "MCP error -32001: Request timed out" },
    });
    expect(cancelled.status).toBe(202);
    expect(await (await call).text()).toContain("released");
    expect(observed!.aborted).toBe(true);
    expect(String((observed!.reason as Error).message)).toContain(
      "Claude Code stopped waiting for this tool call: MCP error -32001: Request timed out",
    );
    // Nested work (e.g. a test run) reads the cause from the abort reason.
    expect(observed!.reason).toBeInstanceOf(CancellationReason);
    expect(observed!.reason).toMatchObject({
      name: "AbortError",
      kind: "claude-code-call-abandoned",
      detail: "MCP error -32001: Request timed out",
    });
  } finally {
    await bridge.close();
  }
});

it("aborts calls still running when the session closes with a session-ended reason", async () => {
  let observed: AbortSignal | undefined;
  const invoke = vi.fn(async (_name, _args, _id, signal: AbortSignal) => {
    observed = signal;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { content: [{ type: "text" as const, text: "released" }] };
  });
  const bridge = await createDyadToolBridge({
    tools: { wait: { inputSchema: z.object({}) } },
    signal: new AbortController().signal,
    invoke,
  });
  const config = JSON.parse(await readFile(bridge.configPath, "utf8"))
    .mcpServers.dyad;
  const call = fetch(config.url, {
    method: "POST",
    headers: {
      ...config.headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    }),
  });
  try {
    await vi.waitFor(() => expect(observed).toBeDefined());
    await bridge.close();
    await call.catch(() => undefined);
    expect(observed!.aborted).toBe(true);
    expect(observed!.reason).toBeInstanceOf(CancellationReason);
    expect((observed!.reason as CancellationReason).kind).toBe(
      "claude-code-session-ended",
    );
  } finally {
    // Closing is the behavior under test; repeating it is a no-op, and it
    // releases the listener and the pending call if an assertion failed first.
    await bridge.close();
  }
});
