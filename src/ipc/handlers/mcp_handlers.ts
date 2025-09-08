import { ipcMain } from "electron";
import { McpManager } from "../utils/mcp_manager";

export function registerMcpHandlers() {
  ipcMain.handle("mcp:test-server", async (_event, params: { id: string }) => {
    if (!params?.id) return { ok: false, error: "Missing server id" };
    return await McpManager.testServerById(params.id);
  });
}

