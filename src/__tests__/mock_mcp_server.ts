import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface MockTool {
  name: string;
  description?: string;
  inputSchema?: { type: "object"; properties?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface MockResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  text: string;
}

export interface MockPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  handler: (args?: Record<string, string>) => {
    description?: string;
    messages: Array<{
      role: "user" | "assistant";
      content: { type: "text"; text: string };
    }>;
  };
}

export interface MockServerOptions {
  tools?: MockTool[];
  resources?: MockResource[];
  prompts?: MockPrompt[];
  /** Optional artificial delay (ms) for tool calls. */
  slowToolMs?: number;
}

export interface MockServerHandle {
  server: Server;
  clientTransport: InMemoryTransport;
  serverTransport: InMemoryTransport;
  close: () => Promise<void>;
}

/**
 * Create an in-memory MCP server pre-wired with the given tools/resources/prompts
 * and a linked client/server transport pair.
 */
export async function createMockMcpServer(
  opts: MockServerOptions = {},
): Promise<MockServerHandle> {
  const tools = opts.tools ?? [];
  const resources = opts.resources ?? [];
  const prompts = opts.prompts ?? [];

  const server = new Server(
    { name: "mock-mcp", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: "object" as const },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    if (opts.slowToolMs && opts.slowToolMs > 0) {
      await new Promise((r) => setTimeout(r, opts.slowToolMs));
    }
    const result = await tool.handler(
      (req.params.arguments ?? {}) as Record<string, unknown>,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = resources.find((x) => x.uri === req.params.uri);
    if (!r) throw new Error(`Unknown resource: ${req.params.uri}`);
    return {
      contents: [
        { uri: r.uri, mimeType: r.mimeType ?? "text/plain", text: r.text },
      ],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = prompts.find((x) => x.name === req.params.name);
    if (!p) throw new Error(`Unknown prompt: ${req.params.name}`);
    return p.handler(req.params.arguments as Record<string, string> | undefined);
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  return {
    server,
    clientTransport,
    serverTransport,
    close: async () => {
      await server.close();
    },
  };
}
