import React, { useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { showError, showSuccess } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import type { McpServer, McpTransport } from "@/lib/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function parseMcpJsonWithTransport(text: string, selectedTransport: McpTransport): { servers: McpServer[] } {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid JSON");
  }
  if (!obj) throw new Error("Empty JSON");
  // New map format: { mcpServers: { "id": { ... } } } or just { "id": { ... } }
  const toServersFromMap = (mapObj: any): McpServer[] => {
    if (!mapObj || typeof mapObj !== "object") return [];
    return Object.entries(mapObj).map(([id, cfg]) => {
      const c: any = cfg || {};
      const transport: McpTransport = c.transport || selectedTransport;
      const server: McpServer = {
        id,
        transport,
        enabled: c.enabled !== false,
        name: c.name,
        // stdio
        command: c.command,
        args: Array.isArray(c.args) ? c.args : c.args ? [String(c.args)] : undefined,
        env: c.env,
        // http
        url: c.url,
        headers: c.headers,
      } as McpServer;
      return server;
    });
  };

  if (obj.mcpServers && !Array.isArray(obj.mcpServers)) {
    return { servers: toServersFromMap(obj.mcpServers) };
  }
  if (!obj.mcpServers && !Array.isArray(obj) && !obj.id) {
    // Accept a raw map without wrapper
    return { servers: toServersFromMap(obj) };
  }
  // Back-compat: { mcpServers: [...] } or array or single object
  if (Array.isArray(obj)) {
    return { servers: obj as McpServer[] };
  }
  if (obj.mcpServers && Array.isArray(obj.mcpServers)) {
    return { servers: obj.mcpServers as McpServer[] };
  }
  if (obj.id && (obj.transport || selectedTransport)) {
    const s: McpServer = { transport: obj.transport || selectedTransport, ...obj } as McpServer;
    return { servers: [s] };
  }
  throw new Error("Unrecognized MCP JSON format");
}

export function MCPIntegration() {
  const { settings, updateSettings } = useSettings();
  const [jsonInput, setJsonInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedTransport, setSelectedTransport] = useState<McpTransport>("stdio");

  const servers = useMemo(() => settings?.mcpServers || [], [settings]);

  const handleAddFromJson = async () => {
    try {
      const { servers: newServers } = parseMcpJsonWithTransport(
        jsonInput,
        selectedTransport,
      );
      if (newServers.length === 0) {
        showError("No servers found in JSON");
        return;
      }
      // merge by id
      const map = new Map<string, McpServer>();
      for (const s of servers) map.set(s.id, s);
      for (const s of newServers) {
        if (!s.id) {
          throw new Error("Each server must include an id (object key)");
        }
        if (!s.transport) {
          s.transport = selectedTransport;
        }
        map.set(s.id, { enabled: true, ...map.get(s.id), ...s });
      }
      await updateSettings({ mcpServers: Array.from(map.values()) });
      setJsonInput("");
      showSuccess("MCP servers updated");
    } catch (e: any) {
      showError(e?.message || String(e));
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    const updated = servers.map((s) => (s.id === id ? { ...s, enabled } : s));
    await updateSettings({ mcpServers: updated });
  };

  const handleRemove = async (id: string) => {
    const updated = servers.filter((s) => s.id !== id);
    await updateSettings({ mcpServers: updated });
  };

  const handleTest = async (id: string) => {
    try {
      setTestingId(id);
      const res = await IpcClient.getInstance().testMcpServer(id);
      if (res.ok) {
        const names = (res.tools || []).map((t) => `${t.serverId}/${t.name}`);
        showSuccess(
          names.length ? `Tools: ${names.join(", ")}` : "No tools reported",
        );
      } else {
        showError(res.error || "Unknown error testing server");
      }
    } catch (e: any) {
      showError(e?.message || String(e));
    } finally {
      setTestingId(null);
    }
  };

  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            MCP Servers
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Paste JSON to add servers. Supports stdio and http transports.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-56">
            <Label>Transport</Label>
            <Select value={selectedTransport} onValueChange={(v) => setSelectedTransport(v as McpTransport)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select transport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="http">http</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Label htmlFor="mcp-json">Add from JSON</Label>
        <textarea
          id="mcp-json"
          className="w-full h-40 rounded-md border bg-transparent p-2 text-sm"
          placeholder={
            selectedTransport === "stdio"
              ? '{\n  "mcpServers": {\n    "mcp-server-id": {\n      "command": "npx",\n      "args": ["vercel-sdk", "mcp"],\n      "env": {\n        "KEY": "XXXXXXXX"\n      }\n    }\n  }\n}'
              : '{\n  "mcpServers": {\n    "mcp-server-id": {\n      "url": "http://localhost:3000/mcp",\n      "headers": {\n        "Authorization": "Bearer {{TOKEN}}"\n      }\n    }\n  }\n}'
          }
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={handleAddFromJson} disabled={isSaving}>
            {isSaving ? "Saving..." : "Add / Merge"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {servers.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No MCP servers configured.
          </p>
        ) : (
          servers.map((s) => (
            <div
              key={s.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {s.name || s.id} <span className="text-xs">({s.transport})</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {s.transport === "http" ? s.url : s.command}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`mcp-enabled-${s.id}`}
                    checked={s.enabled !== false}
                    onCheckedChange={(checked) => handleToggleEnabled(s.id, checked)}
                  />
                  <Label htmlFor={`mcp-enabled-${s.id}`}>Enabled</Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(s.id)}
                  disabled={testingId === s.id}
                >
                  {testingId === s.id ? "Testing..." : "Test"}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleRemove(s.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

