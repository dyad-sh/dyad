/**
 * IPC Handlers — MCP Server control
 *
 * Channels:
 *  - mcp-server:start   → Start the MCP HTTP server on the given (or default) port
 *  - mcp-server:stop    → Stop the MCP server
 *  - mcp-server:status  → Return current status (running, port, url)
 *  - mcp-server:get-config → Return persisted MCP server settings
 */

import { ipcMain } from "electron";
import { JoyCreateMcpServer } from "@/mcp_server";

export function registerMcpServerHandlers() {
  ipcMain.handle(
    "mcp-server:start",
    async (_, params: { port?: number }) => {
      const server = JoyCreateMcpServer.getInstance();
      return server.startHttp(params?.port);
    },
  );

  ipcMain.handle("mcp-server:stop", async () => {
    const server = JoyCreateMcpServer.getInstance();
    await server.stop();
  });

  ipcMain.handle("mcp-server:status", async () => {
    const server = JoyCreateMcpServer.getInstance();
    return server.getStatus();
  });

  ipcMain.handle("mcp-server:get-config", async () => {
    const server = JoyCreateMcpServer.getInstance();
    const status = server.getStatus();
    return {
      defaultPort: 3777,
      currentPort: status.port,
      running: status.running,
      url: status.url,
    };
  });
}
