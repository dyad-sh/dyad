import React, { useEffect, useState } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Transport = "stdio" | "http" | "ws";

export function ToolsMcpSettings() {
  const ipc = IpcClient.getInstance();
  const [servers, setServers] = useState<any[]>([]);
  const [toolsByServer, setToolsByServer] = useState<Record<number, any[]>>({});
  const [consents, setConsents] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);

  const load = async () => {
    const list = await ipc.listMcpServers();
    setServers(list || []);
    const toolsEntries = await Promise.all(
      (list || []).map(
        async (s: any) => [s.id, await ipc.listMcpTools(s.id)] as const,
      ),
    );
    setToolsByServer(Object.fromEntries(toolsEntries));
    const consentsList = await ipc.getMcpToolConsents();
    const consentMap: Record<string, any> = {};
    for (const c of consentsList || []) {
      consentMap[`${c.serverId}:${c.toolName}`] = c.consent;
    }
    setConsents(consentMap);
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async () => {
    await ipc.createMcpServer({
      name,
      transport,
      command: command || null,
      args: args ? args.split(" ") : null,
      url: url || null,
      enabled,
    });
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnabled(true);
    await load();
  };

  const toggleEnabled = async (id: number, current: boolean) => {
    await ipc.updateMcpServer({ id, enabled: !current });
    await load();
  };

  const setToolActive = async (
    serverId: number,
    toolName: string,
    isActive: boolean,
  ) => {
    await ipc.setMcpToolActive({ serverId, toolName, isActive: !isActive });
    await load();
  };

  const setToolConsent = async (
    serverId: number,
    toolName: string,
    consent: "ask" | "always" | "denied",
  ) => {
    await ipc.setMcpToolConsent({ serverId, toolName, consent });
    setConsents((prev) => ({ ...prev, [`${serverId}:${toolName}`]: consent }));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
            />
          </div>
          <div>
            <Label>Transport</Label>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as Transport)}
              className="w-full h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="ws">ws</option>
            </select>
          </div>
          {transport === "stdio" && (
            <>
              <div>
                <Label>Command</Label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="node"
                />
              </div>
              <div>
                <Label>Args</Label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="path/to/server.js --flag"
                />
              </div>
            </>
          )}
          {(transport === "http" || transport === "ws") && (
            <div className="col-span-2">
              <Label>URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label>Enabled</Label>
          </div>
        </div>
        <div>
          <Button onClick={onCreate} disabled={!name.trim()}>
            Add Server
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {servers.map((s) => (
          <div key={s.id} className="border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.transport}
                  {s.url ? ` · ${s.url}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!s.enabled}
                  onCheckedChange={() => toggleEnabled(s.id, !!s.enabled)}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await ipc.deleteMcpServer(s.id);
                    await load();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {(toolsByServer[s.id] || []).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border rounded p-2"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {t.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={consents[`${s.id}:${t.name}`] || "ask"}
                      onValueChange={(v) =>
                        setToolConsent(s.id, t.name, v as any)
                      }
                    >
                      <SelectTrigger className="w-[140px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ask">Ask</SelectItem>
                        <SelectItem value="always">Always allow</SelectItem>
                        <SelectItem value="denied">Deny</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant={t.isActive ? "secondary" : "outline"}
                      onClick={() => setToolActive(s.id, t.name, !!t.isActive)}
                    >
                      {t.isActive ? "Active" : "Activate"}
                    </Button>
                  </div>
                </div>
              ))}
              {(toolsByServer[s.id] || []).length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No tools discovered.
                </div>
              )}
            </div>
          </div>
        ))}
        {servers.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No servers configured yet.
          </div>
        )}
      </div>
    </div>
  );
}
