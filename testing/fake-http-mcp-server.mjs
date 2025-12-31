import http from "http";
import { URL } from "url";

// Expected authorization value - can be set via environment variable
const EXPECTED_AUTH_VALUE = process.env.EXPECTED_AUTH_VALUE || "test-auth-token-123";

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Check authorization for all requests
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== EXPECTED_AUTH_VALUE) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: "Unauthorized",
      message: "Missing or invalid Authorization header"
    }));
    return;
  }

  // Handle SSE endpoint for streaming
  if (req.method === "GET" && (path === "/sse" || path === "/message")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    
    // Send initial connection message
    res.write("data: " + JSON.stringify({ 
      jsonrpc: "2.0",
      method: "notifications/initialized"
    }) + "\n\n");
    
    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30000);
    
    req.on("close", () => {
      clearInterval(keepAlive);
    });
    
    return;
  }

  // Handle POST requests for JSON-RPC messages
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const request = JSON.parse(body);
        
        // Handle initialize request
        if (request.method === "initialize") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "fake-http-mcp",
                version: "0.1.0",
              },
            },
          }));
          return;
        }

        // Handle initialized notification (no response needed)
        if (request.method === "notifications/initialized") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end();
          return;
        }

        // Handle tools/list request
        if (request.method === "tools/list") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              tools: [
                {
                  name: "calculator_add_2",
                  description: "Add two numbers and return the sum",
                  inputSchema: {
                    type: "object",
                    properties: {
                      a: { type: "number", description: "First number" },
                      b: { type: "number", description: "Second number" },
                    },
                    required: ["a", "b"],
                  },
                },
              ],
            },
          }));
          return;
        }

        // Handle tools/call request - verify auth here too
        if (request.method === "tools/call") {
          const { name, arguments: args } = request.params;
          
          if (name === "calculator_add_2") {
            const { a, b } = args;
            const sum = a + b;
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: String(sum),
                  },
                ],
              },
            }));
            return;
          }
          
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Unknown tool: ${name}`,
            },
          }));
          return;
        }

        // Unknown method
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Unknown method: ${request.method}`,
          },
        }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: request?.id || null,
          error: {
            code: -32603,
            message: error.message,
          },
        }));
      }
    });
    return;
  }

  // 404 for unknown paths
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Fake HTTP MCP server running on port ${PORT}`);
  console.log(`Expected auth value: ${EXPECTED_AUTH_VALUE}`);
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
