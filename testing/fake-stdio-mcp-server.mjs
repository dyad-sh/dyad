import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

const server = new McpServer({
  name: "fake-stdio-mcp",
  version: "0.1.0",
});

server.registerTool(
  "calculator_add",
  {
    title: "Calculator Add",
    description: "Add two numbers and return the sum",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => {
    const sum = a + b;
    return {
      content: [{ type: "text", text: String(sum) }],
    };
  },
);

// Artificially slow tool: when called in parallel with a fast tool, its
// result lands out of order (after the fast tool's result). Used by
// mcp_out_of_order.spec.ts.
server.registerTool(
  "slow_add",
  {
    title: "Slow Add",
    description: "Add two numbers but take a while to respond",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => {
    const delayMs = Number(process.env.SLOW_ADD_DELAY_MS ?? "2000");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      content: [{ type: "text", text: `slow:${a + b}` }],
    };
  },
);

server.registerTool(
  "print_envs",
  {
    title: "Print Envs",
    description: "Print the environment variables received by the server",
    inputSchema: {},
  },
  async () => {
    const envObject = Object.fromEntries(
      Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
    );
    const pretty = JSON.stringify(envObject, null, 2);
    return {
      content: [{ type: "text", text: pretty }],
    };
  },
);

server.registerTool(
  "delete_record",
  {
    title: "Delete Record",
    description: "Permanently delete a record by id",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    return {
      content: [{ type: "text", text: `Deleted ${id}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
