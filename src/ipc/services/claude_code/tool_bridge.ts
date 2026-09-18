import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asSchema, type ToolSet } from "ai";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Transport only. Tool callbacks are the same guarded callbacks used by Dyad. */
export async function createDyadToolBridge(options: {
  tools: ToolSet;
  signal: AbortSignal;
  invoke(name: string, args: unknown, id: string): Promise<CallToolResult>;
}) {
  const token = randomBytes(32).toString("hex");
  const closing = new AbortController();
  const signal = AbortSignal.any([options.signal, closing.signal]);
  const active = new Set<Promise<unknown>>();
  const servers = new Set<Server>();
  const calls = new Map<
    string,
    { fingerprint: string; result: Promise<CallToolResult> }
  >();
  const declarations = await Promise.all(
    Object.entries(options.tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: (await asSchema(tool.inputSchema).jsonSchema) as {
        type: "object";
      },
    })),
  );
  const http = createServer((req, res) => {
    if (
      req.headers.authorization !== `Bearer ${token}` ||
      req.headers.origin ||
      req.url !== "/mcp" ||
      signal.aborted
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const server = new Server(
      { name: "dyad", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    servers.add(server);
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: declarations,
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      signal.throwIfAborted();
      const name = request.params.name;
      if (!Object.hasOwn(options.tools, name))
        throw new Error("Tool unavailable");
      const key = String(extra.requestId);
      const fingerprint = JSON.stringify(request.params);
      const prior = calls.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error("Conflicting MCP retry identity");
        return prior.result;
      }
      if (calls.size >= 1000) throw new Error("Turn tool limit exceeded");
      const work = options.invoke(
        name,
        request.params.arguments ?? {},
        randomUUID(),
      );
      calls.set(key, { fingerprint, result: work });
      active.add(work);
      let progress = 0;
      const progressToken = request.params._meta?.progressToken;
      const heartbeat =
        progressToken === undefined
          ? undefined
          : setInterval(() => {
              void server
                .notification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: ++progress,
                    message: "Waiting for Dyad tool completion",
                  },
                })
                .catch(() => {});
            }, 15_000);
      try {
        return await work;
      } finally {
        active.delete(work);
        if (heartbeat) clearInterval(heartbeat);
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      servers.delete(server);
      void server.close();
    });
    void server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  // Human decisions use registry deadlines; this timeout only receives requests.
  http.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  let directory: string | undefined;
  let configPath: string;
  try {
    const address = http.address();
    if (!address || typeof address === "string")
      throw new DyadError("Missing MCP listener", DyadErrorKind.External);
    directory = await mkdtemp(path.join(tmpdir(), "dyad-tools-"));
    configPath = path.join(directory, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          dyad: {
            type: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    http.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    configPath,
    names: declarations.map((tool) => `mcp__dyad__${tool.name}`),
    async close() {
      closing.abort();
      http.close();
      await Promise.allSettled(active);
      await Promise.allSettled([...servers].map((server) => server.close()));
      http.closeAllConnections();
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
