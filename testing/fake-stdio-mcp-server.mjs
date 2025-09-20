import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

const transport = new StdioServerTransport();
await server.connect(transport);
