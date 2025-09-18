import React, { useState } from "react";
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
import { useMcpSettings } from "@/hooks/useMcpSettings";

type Transport = "stdio" | "http";

export function ToolsMcpSettings() {
  const {
    servers,
    toolsByServer,
    consents,
    createServer,
    updateServer,
    deleteServer,
    setToolConsent,
  } = useMcpSettings();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);

  const onCreate = async () => {
    await createServer({
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
  };

  const toggleEnabled = async (id: number, current: boolean) => {
    await updateServer({ id, enabled: !current });
  };

  // Removed activation toggling – tools are used dynamically with consent checks

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
          {transport === "http" && (
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
                    await deleteServer(s.id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {(toolsByServer[s.id] || []).map((t) => (
                <div
                  key={t.name}
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
                      onValueChange={async (v) => {
                        await setToolConsent({
                          serverId: s.id,
                          toolName: t.name,
                          consent: v as any,
                        });
                      }}
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
