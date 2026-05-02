/**
 * Smoke test for the n8n JoyCreate MCP node.
 *
 * We can't spin up a full n8n runtime in unit tests, so instead we:
 *   1. Validate the node's `description` shape (required fields, operation
 *      list, default credential, properties for each operation).
 *   2. Validate the credential schema.
 *   3. Drive the node manifest JSON file.
 *   4. Exercise `execute()` against an in-memory mock IExecuteFunctions
 *      that mocks `httpRequestWithAuthentication`, asserting the right
 *      route + body are sent for each operation.
 *
 * No real HTTP is performed.
 */

import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";

import { JoyCreateMcp } from "../nodes/JoyCreateMcp/JoyCreateMcp.node";
import { JoyCreateApi } from "../credentials/JoyCreateApi.credentials";

// ─── Manifest / static shape checks ───────────────────────────────────

describe("JoyCreateMcp node — manifest shape", () => {
  const node = new JoyCreateMcp();

  it("exposes the expected display + system metadata", () => {
    expect(node.description.name).toBe("joyCreateMcp");
    expect(node.description.displayName).toBe("JoyCreate MCP");
    expect(node.description.icon).toBe("file:joycreate.svg");
    expect(node.description.version).toBe(1);
  });

  it("requires the JoyCreate API credential", () => {
    expect(node.description.credentials).toEqual([
      { name: "joyCreateApi", required: true },
    ]);
  });

  it("declares all four operations", () => {
    const ops = node.description.properties.find((p) => p.name === "operation");
    expect(ops).toBeDefined();
    const values = (ops!.options as Array<{ value: string }>).map(
      (o) => o.value,
    );
    expect(values.sort()).toEqual(
      ["callTool", "listResources", "listServers", "listTools"].sort(),
    );
  });

  it("ships a node manifest JSON next to the .node.ts file", () => {
    const manifestPath = path.resolve(
      __dirname,
      "..",
      "nodes",
      "JoyCreateMcp",
      "JoyCreateMcp.node.json",
    );
    expect(fs.existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(parsed.node).toMatch(/joyCreateMcp/);
  });
});

describe("JoyCreateApi credential", () => {
  const cred = new JoyCreateApi();

  it("declares serverUrl + apiToken properties", () => {
    const names = cred.properties.map((p) => p.name);
    expect(names).toContain("serverUrl");
    expect(names).toContain("apiToken");
  });

  it("targets the expected list-servers route for credential test", () => {
    expect(cred.test.request.url).toBe("/api/mcp/list-servers");
    expect(cred.test.request.method).toBe("POST");
  });
});

// ─── execute() behavioural tests ───────────────────────────────────────

type Mock = ReturnType<typeof vi.fn>;
function makeExecuteCtx(opts: {
  params: Record<string, unknown>;
  items?: unknown[];
  httpMock: Mock;
  continueOnFail?: boolean;
}) {
  const items = (opts.items ?? [{ json: {} }]) as Array<{
    json: Record<string, unknown>;
  }>;
  return {
    getInputData: () => items,
    getNodeParameter: (
      name: string,
      _index: number,
      defaultValue?: unknown,
    ) => {
      if (Object.prototype.hasOwnProperty.call(opts.params, name)) {
        return opts.params[name];
      }
      return defaultValue;
    },
    getNode: () => ({ name: "JoyCreate MCP" }),
    continueOnFail: () => Boolean(opts.continueOnFail),
    helpers: {
      httpRequestWithAuthentication: {
        // n8n calls helpers via `.call(this, ...)` so we expose a function
        // whose `this` is irrelevant for the mock.
        call: (_thisArg: unknown, _credName: string, options: unknown) =>
          opts.httpMock(options),
      },
    },
  } as unknown as Parameters<JoyCreateMcp["execute"]>[0] & object;
}

describe("JoyCreateMcp.execute()", () => {
  it("hits /api/mcp/list-servers for listServers", async () => {
    const httpMock = vi.fn().mockResolvedValue({ servers: [] });
    const ctx = makeExecuteCtx({
      params: { operation: "listServers" },
      httpMock,
    });
    const node = new JoyCreateMcp();
    const result = await node.execute.call(ctx as never);
    expect(httpMock).toHaveBeenCalledTimes(1);
    const callArgs = httpMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.url).toBe("/api/mcp/list-servers");
    expect(callArgs.method).toBe("POST");
    expect(result[0][0].json.operation).toBe("listServers");
  });

  it("scopes listTools by serverIdOptional when > 0", async () => {
    const httpMock = vi.fn().mockResolvedValue({ tools: [] });
    const ctx = makeExecuteCtx({
      params: { operation: "listTools", serverIdOptional: 7 },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await node.execute.call(ctx as never);
    expect(httpMock.mock.calls[0][0].body).toEqual({ serverId: 7 });
  });

  it("does NOT include serverId when serverIdOptional is 0", async () => {
    const httpMock = vi.fn().mockResolvedValue({ tools: [] });
    const ctx = makeExecuteCtx({
      params: { operation: "listTools", serverIdOptional: 0 },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await node.execute.call(ctx as never);
    expect(httpMock.mock.calls[0][0].body).toEqual({});
  });

  it("forwards serverId/name/args to /api/mcp/call-tool", async () => {
    const httpMock = vi.fn().mockResolvedValue({ ok: true, content: [] });
    const ctx = makeExecuteCtx({
      params: {
        operation: "callTool",
        serverId: 3,
        toolName: "create_issue",
        argsJson: { repo: "acme/wid", title: "x" },
      },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await node.execute.call(ctx as never);
    const body = httpMock.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.serverId).toBe(3);
    expect(body.name).toBe("create_issue");
    expect(body.args).toEqual({ repo: "acme/wid", title: "x" });
  });

  it("parses string-form JSON args defensively", async () => {
    const httpMock = vi.fn().mockResolvedValue({ ok: true });
    const ctx = makeExecuteCtx({
      params: {
        operation: "callTool",
        serverId: 1,
        toolName: "x",
        argsJson: '{"foo": 42}',
      },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await node.execute.call(ctx as never);
    expect(
      (httpMock.mock.calls[0][0].body as Record<string, unknown>).args,
    ).toEqual({ foo: 42 });
  });

  it("rejects malformed JSON args", async () => {
    const httpMock = vi.fn();
    const ctx = makeExecuteCtx({
      params: {
        operation: "callTool",
        serverId: 1,
        toolName: "x",
        argsJson: "{not json",
      },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await expect(node.execute.call(ctx as never)).rejects.toThrow(
      /Tool arguments are not valid JSON/,
    );
    expect(httpMock).not.toHaveBeenCalled();
  });

  it("passes serverId through for listResources", async () => {
    const httpMock = vi.fn().mockResolvedValue({ resources: [] });
    const ctx = makeExecuteCtx({
      params: { operation: "listResources", serverId: 4 },
      httpMock,
    });
    const node = new JoyCreateMcp();
    await node.execute.call(ctx as never);
    expect(httpMock.mock.calls[0][0].url).toBe("/api/mcp/list-resources");
    expect(httpMock.mock.calls[0][0].body).toEqual({ serverId: 4 });
  });

  it("captures error into output when continueOnFail is true", async () => {
    const httpMock = vi.fn().mockRejectedValue(new Error("boom"));
    const ctx = makeExecuteCtx({
      params: { operation: "listServers" },
      httpMock,
      continueOnFail: true,
    });
    const node = new JoyCreateMcp();
    const result = await node.execute.call(ctx as never);
    expect(result[0][0].json.error).toBe("boom");
  });
});
