import React, { useMemo, useState } from "react";
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
import { useMcp, type Transport } from "@/hooks/useMcp";
import { showError, showSuccess } from "@/lib/toast";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";

type KeyValue = { key: string; value: string };

function parseEnvJsonToArray(
  envJson?: Record<string, string> | string | null,
): KeyValue[] {
  if (!envJson) return [];
  try {
    const obj =
      typeof envJson === "string"
        ? (JSON.parse(envJson) as unknown as Record<string, string>)
        : (envJson as Record<string, string>);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
    }));
  } catch {
    return [];
  }
}

function arrayToEnvObject(envVars: KeyValue[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of envVars) {
    if (key.trim().length === 0) continue;
    env[key.trim()] = value;
  }
  return env;
}

function EnvVarsEditor({
  serverId,
  envJson,
  disabled,
  onSave,
  isSaving,
}: {
  serverId: number;
  envJson?: Record<string, string> | null;
  disabled?: boolean;
  onSave: (envVars: KeyValue[]) => Promise<void>;
  isSaving: boolean;
}) {
  const initial = useMemo(() => parseEnvJsonToArray(envJson), [envJson]);
  const [envVars, setEnvVars] = useState<KeyValue[]>(initial);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);

  React.useEffect(() => {
    setEnvVars(initial);
  }, [serverId, initial]);

  const saveAll = async (next: KeyValue[]) => {
    await onSave(next);
    setEnvVars(next);
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      showError("Both key and value are required");
      return;
    }
    if (envVars.some((e) => e.key === newKey.trim())) {
      showError("Environment variable with this key already exists");
      return;
    }
    const next = [...envVars, { key: newKey.trim(), value: newValue.trim() }];
    await saveAll(next);
    setNewKey("");
    setNewValue("");
    setIsAddingNew(false);
    showSuccess("Environment variables saved");
  };

  const handleEdit = (kv: KeyValue) => {
    setEditingKey(kv.key);
    setEditingKeyValue(kv.key);
    setEditingValue(kv.value);
  };

  const handleSaveEdit = async () => {
    if (!editingKey) return;
    if (!editingKeyValue.trim() || !editingValue.trim()) {
      showError("Both key and value are required");
      return;
    }
    if (
      envVars.some(
        (e) => e.key === editingKeyValue.trim() && e.key !== editingKey,
      )
    ) {
      showError("Environment variable with this key already exists");
      return;
    }
    const next = envVars.map((e) =>
      e.key === editingKey
        ? { key: editingKeyValue.trim(), value: editingValue.trim() }
        : e,
    );
    await saveAll(next);
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
    showSuccess("Environment variables saved");
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  };

  const handleDelete = async (key: string) => {
    const next = envVars.filter((e) => e.key !== key);
    await saveAll(next);
    showSuccess("Environment variables saved");
  };

  return (
    <div className="mt-3 space-y-3">
      {isAddingNew ? (
        <div className="space-y-3 p-3 border rounded-md bg-muted/50">
          <div className="space-y-2">
            <Label htmlFor={`env-new-key-${serverId}`}>Key</Label>
            <Input
              id={`env-new-key-${serverId}`}
              placeholder="e.g., PATH"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
              disabled={disabled || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`env-new-value-${serverId}`}>Value</Label>
            <Input
              id={`env-new-value-${serverId}`}
              placeholder="e.g., /usr/local/bin"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              disabled={disabled || isSaving}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleAdd}
              size="sm"
              disabled={disabled || isSaving}
            >
              <Save size={14} />
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={() => {
                setIsAddingNew(false);
                setNewKey("");
                setNewValue("");
              }}
              variant="outline"
              size="sm"
            >
              <X size={14} />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setIsAddingNew(true)}
          variant="outline"
          className="w-full"
          disabled={disabled}
        >
          <Plus size={14} />
          Add Environment Variable
        </Button>
      )}

      <div className="space-y-2">
        {envVars.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No environment variables configured
          </p>
        ) : (
          envVars.map((kv) => (
            <div
              key={kv.key}
              className="flex items-center space-x-2 p-2 border rounded-md"
            >
              {editingKey === kv.key ? (
                <>
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editingKeyValue}
                      onChange={(e) => setEditingKeyValue(e.target.value)}
                      placeholder="Key"
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      placeholder="Value"
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={handleSaveEdit}
                      size="sm"
                      variant="outline"
                      disabled={disabled || isSaving}
                    >
                      <Save size={14} />
                    </Button>
                    <Button
                      onClick={handleCancelEdit}
                      size="sm"
                      variant="outline"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{kv.key}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {kv.value}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => handleEdit(kv)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={disabled}
                    >
                      <Edit2 size={14} />
                    </Button>
                    <Button
                      onClick={() => handleDelete(kv.key)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      disabled={disabled || isSaving}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ToolsMcpSettings() {
  const {
    servers,
    toolsByServer,
    consentsMap,
    createServer,
    toggleEnabled: toggleServerEnabled,
    deleteServer,
    setToolConsent: updateToolConsent,
    updateServer,
    isUpdatingServer,
  } = useMcp();
  const [consents, setConsents] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string>("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);

  React.useEffect(() => {
    setConsents(consentsMap);
  }, [consentsMap]);

  const onCreate = async () => {
    const parsedArgs = (() => {
      const trimmed = args.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("[")) {
        try {
          const arr = JSON.parse(trimmed);
          return Array.isArray(arr) && arr.every((x) => typeof x === "string")
            ? (arr as string[])
            : null;
        } catch {
          // fall through
        }
      }
      return trimmed.split(" ").filter(Boolean);
    })();
    await createServer({
      name,
      transport,
      command: command || null,
      args: parsedArgs,
      url: url || null,
      enabled,
    });
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnabled(true);
  };

  // Removed activation toggling – tools are used dynamically with consent checks

  const onSetToolConsent = async (
    serverId: number,
    toolName: string,
    consent: "ask" | "always" | "denied",
  ) => {
    await updateToolConsent(serverId, toolName, consent);
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
                  placeholder="path/to/mcp-server.js --flag"
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
                  {s.command ? ` · ${s.command}` : ""}
                  {Array.isArray(s.args) && s.args.length
                    ? ` · ${s.args.join(" ")}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!s.enabled}
                  onCheckedChange={() => toggleServerEnabled(s.id, !!s.enabled)}
                />
                <Button variant="outline" onClick={() => deleteServer(s.id)}>
                  Delete
                </Button>
              </div>
            </div>
            {s.transport === "stdio" && (
              <div className="mt-3">
                <div className="text-sm font-medium mb-2">
                  Environment Variables
                </div>
                <EnvVarsEditor
                  serverId={s.id}
                  envJson={s.envJson}
                  disabled={!s.enabled}
                  isSaving={!!isUpdatingServer}
                  onSave={async (pairs) => {
                    await updateServer({
                      id: s.id,
                      envJson: arrayToEnvObject(pairs),
                    });
                  }}
                />
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(toolsByServer[s.id] || []).map((t) => (
                <div key={t.name} className="border rounded p-2">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-sm truncate">{t.name}</div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={consents[`${s.id}:${t.name}`] || "ask"}
                        onValueChange={(v) =>
                          onSetToolConsent(s.id, t.name, v as any)
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
                    </div>
                  </div>
                  {t.description && (
                    <div className="mt-1 text-xs max-w-[500px] text-muted-foreground truncate">
                      {t.description}
                    </div>
                  )}
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
