import React, { useEffect, useMemo, useState } from "react";
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
import { DEFAULT_OAUTH_CALLBACK_PORT } from "@/ipc/types/mcp";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddMcpServerDeepLinkData } from "@/ipc/deep_link_data";
import { useTranslation } from "react-i18next";

type KeyValue = { key: string; value: string };

function parseJsonToArray(
  json?: Record<string, string> | string | null,
): KeyValue[] {
  if (!json) return [];
  try {
    const obj =
      typeof json === "string"
        ? (JSON.parse(json) as unknown as Record<string, string>)
        : (json as Record<string, string>);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
    }));
  } catch {
    return [];
  }
}

function arrayToJsonObject(envVars: KeyValue[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of envVars) {
    if (key.trim().length === 0) continue;
    env[key.trim()] = value;
  }
  return env;
}

function KeyValueEditor({
  id,
  json,
  disabled,
  onSave,
  isSaving,
  itemLabel = "Environment Variable",
}: {
  id: number;
  json?: Record<string, string> | null;
  disabled?: boolean;
  onSave: (envVars: KeyValue[]) => Promise<void>;
  isSaving: boolean;
  itemLabel?: string;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const initial = useMemo(() => parseJsonToArray(json), [json]);
  const [envVars, setEnvVars] = useState<KeyValue[]>(initial);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);

  React.useEffect(() => {
    setEnvVars(initial);
  }, [id, initial]);

  const saveAll = async (next: KeyValue[]) => {
    await onSave(next);
    setEnvVars(next);
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      showError(t("toolsMcp.keyValueRequired"));
      return;
    }
    if (envVars.some((e) => e.key === newKey.trim())) {
      showError(t("settings:toolsMcp.duplicateKey"));
      return;
    }
    const next = [...envVars, { key: newKey.trim(), value: newValue.trim() }];
    await saveAll(next);
    setNewKey("");
    setNewValue("");
    setIsAddingNew(false);
    showSuccess(`${itemLabel}s saved`);
  };

  const handleEdit = (kv: KeyValue) => {
    setEditingKey(kv.key);
    setEditingKeyValue(kv.key);
    setEditingValue(kv.value);
  };

  const handleSaveEdit = async () => {
    if (!editingKey) return;
    if (!editingKeyValue.trim() || !editingValue.trim()) {
      showError(t("toolsMcp.keyValueRequired"));
      return;
    }
    if (
      envVars.some(
        (e) => e.key === editingKeyValue.trim() && e.key !== editingKey,
      )
    ) {
      showError(t("settings:toolsMcp.duplicateKey"));
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
    showSuccess(`${itemLabel}s saved`);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  };

  const handleDelete = async (key: string) => {
    const next = envVars.filter((e) => e.key !== key);
    await saveAll(next);
    showSuccess(`${itemLabel}s saved`);
  };

  return (
    <div className="mt-3 space-y-3">
      {isAddingNew ? (
        <div className="space-y-3 p-3 border rounded-md bg-muted/50">
          <div className="space-y-2">
            <Label htmlFor={`env-new-key-${id}`}>
              {t("settings:toolsMcp.key")}
            </Label>
            <Input
              id={`env-new-key-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.key")
                  : t("settings:toolsMcp.keyPlaceholder")
              }
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
              disabled={disabled || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`env-new-value-${id}`}>
              {t("settings:toolsMcp.value")}
            </Label>
            <Input
              id={`env-new-value-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.value")
                  : t("settings:toolsMcp.valuePlaceholder")
              }
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
              {isSaving ? t("common:saving") : t("common:save")}
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
              {t("common:cancel")}
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
          {t("settings:toolsMcp.addEnvVar")}
        </Button>
      )}

      <div className="space-y-2">
        {envVars.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No {itemLabel.toLowerCase()}s configured
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
    startOAuth,
    disconnectOAuth,
    isStartingOAuth,
    isDisconnectingOAuth,
  } = useMcp();
  const [consents, setConsents] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string>("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [connectingServerId, setConnectingServerId] = useState<number | null>(
    null,
  );
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  console.log("lastDeepLink!!!", lastDeepLink);
  useEffect(() => {
    console.log("rerun effect");
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "add-mcp-server") {
        const deepLink = lastDeepLink as AddMcpServerDeepLinkData;
        const payload = deepLink.payload;
        showInfo(`Prefilled ${payload.name} MCP server`);
        setName(payload.name);
        setTransport(payload.config.type);
        if (payload.config.type === "stdio") {
          const [command, ...args] = payload.config.command.split(" ");
          setCommand(command);
          setArgs(args.join(" "));
        } else {
          setUrl(payload.config.url);
        }
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

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
      oauthEnabled: oauthEnabled && transport !== "stdio",
      oauthClientId: oauthClientId.trim() || null,
      oauthClientSecret: oauthClientSecret.trim() || null,
      oauthScope: oauthScope.trim() || null,
    });
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnabled(true);
    setOauthEnabled(false);
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthScope("");
  };

  const onConnect = async (serverId: number) => {
    setConnectingServerId(serverId);
    try {
      const result = await startOAuth({ serverId });
      if (!result.success) {
        showError(result.error ?? "OAuth flow failed");
      } else {
        showSuccess("OAuth connection successful");
      }
    } finally {
      setConnectingServerId(null);
    }
  };

  const onDisconnect = async (serverId: number) => {
    const result = await disconnectOAuth(serverId);
    if (result.success) {
      showSuccess("Disconnected OAuth");
    } else {
      showError("Failed to disconnect OAuth");
    }
  };

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
            <Label htmlFor="mcp-transport-select">Transport</Label>
            <select
              id="mcp-transport-select"
              data-testid="mcp-transport-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value as Transport)}
              className="w-full h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
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
          {(transport === "http" || transport === "sse") && (
            <>
              <div className="col-span-2">
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    transport === "sse"
                      ? "https://mcp.example.com/sse"
                      : "http://localhost:3000"
                  }
                />
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <Switch
                  aria-label="Use OAuth"
                  checked={oauthEnabled}
                  onCheckedChange={setOauthEnabled}
                />
                <Label>Use OAuth (server requires authentication)</Label>
              </div>
              {oauthEnabled && (
                <>
                  <div className="col-span-2">
                    <Label>
                      OAuth Client ID
                      <span className="ml-1 text-xs text-muted-foreground">
                        If the MCP server's setup requires you to register an
                        app, paste the Client ID of your app here. Otherwise
                        leave this blank.
                      </span>
                    </Label>
                    <Input
                      value={oauthClientId}
                      onChange={(e) => setOauthClientId(e.target.value)}
                      placeholder="Pre-registered client ID"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>
                      OAuth Client Secret
                      <span className="ml-1 text-xs text-muted-foreground">
                        Include this only if the MCP server gave you a secret
                        alongside the Client ID.
                      </span>
                    </Label>
                    <Input
                      type="password"
                      value={oauthClientSecret}
                      onChange={(e) => setOauthClientSecret(e.target.value)}
                      placeholder="Pre-registered client secret"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>
                      OAuth Scope
                      <span className="ml-1 text-xs text-muted-foreground">
                        Permissions to request, space-separated. Leave this
                        blank to use the server's default.
                      </span>
                    </Label>
                    <Input
                      value={oauthScope}
                      onChange={(e) => setOauthScope(e.target.value)}
                      placeholder=""
                    />
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground">
                    If you include a Client ID, make sure that you register{" "}
                    <code>
                      http://localhost:{DEFAULT_OAUTH_CALLBACK_PORT}/callback
                    </code>{" "}
                    as a redirect URI for your MCP server. Your MCP server most
                    likely provides a dashboard where you can do this.
                  </div>
                </>
              )}
            </>
          )}
          <div className="flex items-center gap-2">
            <Switch
              aria-label="Enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
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
                <div className="font-medium flex items-center gap-2">
                  {s.name}
                  {s.oauthEnabled && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        s.oauthConnected
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                      }`}
                    >
                      OAuth: {s.oauthConnected ? "connected" : "not connected"}
                    </span>
                  )}
                </div>
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
                {s.oauthEnabled && !s.oauthConnected && (
                  <Button
                    variant="default"
                    onClick={() => onConnect(s.id)}
                    disabled={isStartingOAuth}
                  >
                    {isStartingOAuth && connectingServerId === s.id
                      ? "Connecting…"
                      : "Connect"}
                  </Button>
                )}
                {s.oauthEnabled && s.oauthConnected && (
                  <Button
                    variant="outline"
                    onClick={() => onDisconnect(s.id)}
                    disabled={isDisconnectingOAuth}
                  >
                    Disconnect
                  </Button>
                )}
                <Switch
                  aria-label={`Toggle ${s.name}`}
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
                <KeyValueEditor
                  id={s.id}
                  json={s.envJson}
                  disabled={!s.enabled}
                  isSaving={!!isUpdatingServer}
                  onSave={async (pairs) => {
                    await updateServer({
                      id: s.id,
                      envJson: arrayToJsonObject(pairs),
                    });
                  }}
                />
              </div>
            )}
            {(s.transport === "http" || s.transport === "sse") && (
              <div className="mt-3">
                <div className="text-sm font-medium mb-2">Headers</div>
                <KeyValueEditor
                  id={s.id}
                  json={s.headersJson}
                  disabled={!s.enabled}
                  isSaving={!!isUpdatingServer}
                  itemLabel="Header"
                  onSave={async (pairs) => {
                    await updateServer({
                      id: s.id,
                      headersJson: arrayToJsonObject(pairs),
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
