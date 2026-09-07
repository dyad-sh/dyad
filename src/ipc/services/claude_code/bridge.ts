import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { READ_TOOLS, WRITE_TOOLS } from "./runtime";

export interface BridgeOperations {
  appPath: string;
  readOnly: boolean;
  signal: AbortSignal;
  approve(tool: string, input: unknown): Promise<boolean>;
  diagnostics(): Promise<unknown>;
  checks(): Promise<unknown>;
  tests(): Promise<unknown>;
  dependencies(packages: string[]): Promise<unknown>;
  restart(): Promise<unknown>;
  onTool(name: string, complete: boolean): Promise<void>;
}
const EmptySchema = z.object({}).strict();
const PackagesSchema = z
  .object({ packages: z.array(z.string().max(200)).min(1).max(20) })
  .strict();
const PermissionSchema = z.object({
  tool_name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
const toolNames = [
  "diagnostics",
  "type_check",
  "run_tests",
  "install_dependencies",
  "restart_preview",
];

export async function isClaudeFileRequestInApp(
  appPath: string,
  tool: string,
  input: Record<string, unknown>,
) {
  const target =
    tool === "Read" || WRITE_TOOLS.includes(tool)
      ? input.file_path
      : (input.path ?? ".");
  if (typeof target !== "string" || !target) return false;
  if (
    tool === "Glob" &&
    (typeof input.pattern !== "string" ||
      path.isAbsolute(input.pattern) ||
      input.pattern.split(/[\\/]/).includes(".."))
  )
    return false;
  const lexicalRoot = path.resolve(appPath);
  const root = await realpath(appPath);
  const inside = (candidate: string, base = root) => {
    const relative = path.relative(base, candidate);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`))
    );
  };
  let candidate = path.resolve(lexicalRoot, target);
  if (!inside(candidate) && !inside(candidate, lexicalRoot)) return false;
  // New files may not exist yet. Check the closest existing ancestor, including
  // symlinks, before approving. This is a path guard, not an OS sandbox.
  for (;;) {
    try {
      return inside(await realpath(candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = path.dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
    }
  }
}

/** Per-turn closure binds app/session authority. No caller supplies an app ID,
 * command, path or address to redirect a controlled operation. */
export async function createClaudeBridge(ops: BridgeOperations) {
  const bearer = randomBytes(32).toString("hex");
  const active = new Set<Promise<unknown>>();
  const transports = new Set<StreamableHTTPServerTransport>();
  const http = createServer((req, res) => {
    if (
      req.headers.authorization !== `Bearer ${bearer}` ||
      req.headers.origin ||
      req.url !== "/mcp" ||
      ops.signal.aborted
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const work = (async () => {
      const server = new Server(
        { name: "dyad", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      const names = ops.readOnly ? ["diagnostics"] : toolNames;
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "permission",
            description: "Dyad host permission handler",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                input: { type: "object" },
              },
              required: ["tool_name", "input"],
            },
          },
          ...names.map((name) => ({
            name,
            description:
              name === "diagnostics"
                ? "Read this app's preview diagnostics"
                : `Dyad ${name}: approval required; may execute project code.`,
            inputSchema:
              name === "install_dependencies"
                ? {
                    type: "object" as const,
                    properties: {
                      packages: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 1,
                        maxItems: 20,
                      },
                    },
                    required: ["packages"],
                    additionalProperties: false,
                  }
                : {
                    type: "object" as const,
                    properties: {},
                    additionalProperties: false,
                  },
          })),
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const text = (value: unknown) => ({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(value).slice(0, 30_000),
            },
          ],
        });
        try {
          ops.signal.throwIfAborted();
          const { name, arguments: args } = request.params;
          if (name === "permission") {
            const { tool_name, input } = PermissionSchema.parse(args);
            const mcp = names.some((n) => tool_name === `mcp__dyad__${n}`);
            const available =
              mcp ||
              READ_TOOLS.includes(tool_name) ||
              (!ops.readOnly && WRITE_TOOLS.includes(tool_name));
            const allow =
              available &&
              (mcp ||
                (await isClaudeFileRequestInApp(
                  ops.appPath,
                  tool_name,
                  input,
                ))) &&
              (mcp ||
                READ_TOOLS.includes(tool_name) ||
                (await ops.approve(tool_name, input)));
            return text(
              allow && !ops.signal.aborted
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: "Dyad denied this operation." },
            );
          }
          if (!names.includes(name))
            throw new Error("Tool unavailable in this mode");
          const parsed =
            name === "install_dependencies"
              ? PackagesSchema.parse(args)
              : EmptySchema.parse(args ?? {});
          if (name !== "diagnostics" && !(await ops.approve(name, parsed)))
            throw new Error("Denied");
          ops.signal.throwIfAborted();
          await ops.onTool(name, false);
          const result =
            name === "diagnostics"
              ? await ops.diagnostics()
              : name === "type_check"
                ? await ops.checks()
                : name === "run_tests"
                  ? await ops.tests()
                  : name === "install_dependencies"
                    ? await ops.dependencies(
                        PackagesSchema.parse(parsed).packages,
                      )
                    : await ops.restart();
          await ops.onTool(name, true);
          return text(result);
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Dyad operation failed or was denied. Inspect the Dyad chat and preview diagnostics.",
              },
            ],
          };
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      transports.add(transport);
      res.on("close", () => {
        transports.delete(transport);
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    active.add(work);
    void work.finally(() => active.delete(work));
  });
  http.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("MCP listener failed");
  const directory = await mkdtemp(path.join(tmpdir(), "dyad-claude-mcp-"));
  const configPath = path.join(directory, "mcp.json");
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        dyad: {
          type: "http",
          url: `http://127.0.0.1:${address.port}/mcp`,
          headers: { Authorization: `Bearer ${bearer}` },
        },
      },
    }),
    { mode: 0o600 },
  );
  return {
    configPath,
    async close() {
      http.close();
      await Promise.allSettled(active);
      await Promise.allSettled(
        [...transports].map((transport) => transport.close()),
      );
      http.closeAllConnections();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
