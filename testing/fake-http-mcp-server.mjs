import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod/v3";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;

function createMcpServer() {
  const server = new McpServer({
    name: "fake-http-mcp",
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

  return server;
}

const activeServers = new Set();

// Create HTTP server
const httpServer = createServer(async (req, res) => {
  // Only handle requests to /mcp endpoint
  if (req.url !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  try {
    // Stateless transports are request-scoped in MCP SDK 1.30. Reusing one
    // rejects subsequent discovery/initialization/tool requests.
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    activeServers.add(server);
    res.on("close", () => {
      activeServers.delete(server);
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  // Log the bound port, not the requested one: callers may pass PORT=0 and
  // parse the actual port from this line (see hybrid_chat_harness.tsx).
  const actualPort = httpServer.address().port;
  console.log(`HTTP MCP server running on http://localhost:${actualPort}/mcp`);
  console.log(`Environment variables:`, Object.keys(process.env).length);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");
  await Promise.all([...activeServers].map((server) => server.close()));
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down server...");
  await Promise.all([...activeServers].map((server) => server.close()));
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
