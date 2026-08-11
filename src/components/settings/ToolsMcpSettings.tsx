import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMcp, type Transport } from "@/hooks/useMcp";
import { useSettings } from "@/hooks/useSettings";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import {
  AlertCircle,
  KeyRound,
  ChevronDown,
  ChevronLeft,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddMcpServerDeepLinkData } from "@/ipc/deep_link_data";
import { useTranslation } from "react-i18next";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";
import type { McpConnectionStatus } from "@/ipc/types";

type KeyValue = { key: string; value: string };

type McpView = "index" | "servers" | "config";

const MCP_DESTINATIONS = [
  {
    id: "servers" as const,
    title: "MCP Servers",
    description:
      "The servers you have added. Switch one on to offer its tools in the chat toolbar, or off to hide it there.",
    icon: Plug,
  },
  {
    id: "config" as const,
    title: "Server Configuration",
    description:
      "Add a server by pasting its config snippet, or fill in the transport, address and headers yourself.",
    icon: Plus,
  },
];

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

function parseHeadersInput(headers: string): Record<string, string> | null {
  const trimmed = headers.trim();
  if (!trimmed) return null;

  if (/^Bearer\s+/i.test(trimmed)) {
    return { Authorization: trimmed };
  }

  if (!trimmed.startsWith("{")) {
    const entries = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          throw new Error(
            "Headers must be JSON, Key: Value lines, or a Bearer token",
          );
        }
        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ] as const;
      });

    return Object.fromEntries(
      entries.filter(([key, value]) => key.length > 0 && value.length > 0),
    );
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
  );
}

function maskHeaderValue(key: string, value: string): string {
  if (/authorization|token|secret|key/i.test(key)) {
    return value ? "********" : "";
  }
  return value;
}

function getChatAgentToolKey(serverId: number, toolName: string): string {
  return `${serverId}:${toolName}`;
}

function getChatAgentWorkflowKey(serverId: number, workflowId: string): string {
  return `${serverId}:${workflowId}`;
}

function McpConnectionIndicator({
  enabled,
  status,
  isChecking,
}: {
  enabled: boolean;
  status?: McpConnectionStatus;
  isChecking: boolean;
}) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-muted-foreground/50" />
        Disabled
      </span>
    );
  }

  if (isChecking && !status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-500">
        <Loader2 className="size-3 animate-spin" />
        Checking
      </span>
    );
  }

  if (status?.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500"
        title={`${status.toolCount ?? 0} tools/workflows discovered`}
      >
        <CheckCircle2 className="size-3" />
        Connected
        {status.toolCount != null ? ` (${status.toolCount})` : ""}
      </span>
    );
  }

  // Needing a sign-in is not the same as being broken, and it is the one of
  // these the user can act on. Amber, and named for what to do about it.
  if (status && !status.ok && status.reason === "unauthorized") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500"
        title={status.error}
        data-testid="mcp-status-unauthorized"
      >
        <KeyRound className="size-3" />
        Sign-in required
      </span>
    );
  }

  if (status && !status.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
        title={status.error}
      >
        <AlertCircle className="size-3" />
        {status.reason === "unreachable" ? "Unreachable" : "Error"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      Checking
    </span>
  );
}

function CollapsibleMcpSection({
  title,
  description,
  count,
  selectedCount,
  defaultOpen = false,
  accent = false,
  children,
  actions,
}: {
  title: string;
  description: string;
  count: number;
  selectedCount?: number;
  defaultOpen?: boolean;
  accent?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={
        accent
          ? "rounded-lg border border-cyan-500/20 bg-cyan-500/5"
          : "rounded-lg border"
      }
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ChevronDown
            className={[
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open ? "" : "-rotate-90",
            ].join(" ")}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{title}</span>
              <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
                {selectedCount != null
                  ? `${selectedCount}/${count} enabled`
                  : `${count} found`}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              {description}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {open && <div className="space-y-2 border-t p-3">{children}</div>}
    </div>
  );
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
                      {itemLabel === "Header"
                        ? maskHeaderValue(kv.key, kv.value)
                        : kv.value}
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
    workflowsByServer,
    connectionStatuses,
    consentsMap,
    createServer,
    toggleEnabled: toggleServerEnabled,
    deleteServer,
    setToolConsent: updateToolConsent,
    updateServer,
    refetchAll,
    isUpdatingServer,
    isCheckingConnections,
  } = useMcp();
  const { settings, updateSettings } = useSettings();
  const [consents, setConsents] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string>("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [importConfig, setImportConfig] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [mcpView, setMcpView] = useState<McpView>("index");
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  // What the wrench in the chat bar will actually offer.
  const enabledCount = servers.filter((server) => server.enabled).length;
  const chatAgentMcpServerIds = settings?.chatAgentMcpServerIds ?? [];
  const chatAgentMcpToolKeys = settings?.chatAgentMcpToolKeys ?? [];
  const chatAgentMcpWorkflowKeys = settings?.chatAgentMcpWorkflowKeys ?? [];

  useEffect(() => {
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
    // Keyed on the deep-link timestamp so this runs once per incoming deep
    // link; intentionally not re-run when callback/object identities change.
    // eslint-disable-next-line react/exhaustive-deps
  }, [lastDeepLink?.timestamp]);

  React.useEffect(() => {
    setConsents(consentsMap);
  }, [consentsMap]);

  const onCreate = async () => {
    if (!name.trim()) {
      showError("Server name is required");
      return;
    }
    if (transport === "http" && !url.trim()) {
      showError("HTTP MCP servers require a URL");
      return;
    }

    let parsedHeaders: Record<string, string> | null = null;
    if (transport === "http") {
      try {
        parsedHeaders = parseHeadersInput(headersText);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Invalid headers");
        return;
      }
    }

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
      headersJson: parsedHeaders,
      enabled,
    });
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setHeadersText("");
    setEnabled(true);
    // Adding is finished, so the page returns to the list where the new
    // service now appears. A cleared form left in view reads as a failure.
    setMcpView("servers");
  };

  const onImportConfig = async () => {
    try {
      const parsed = JSON.parse(importConfig) as unknown;
      const serversConfig =
        parsed &&
        typeof parsed === "object" &&
        "mcpServers" in parsed &&
        parsed.mcpServers &&
        typeof parsed.mcpServers === "object"
          ? (parsed.mcpServers as Record<string, any>)
          : null;

      const entries = serversConfig ? Object.entries(serversConfig) : [];
      if (entries.length === 0) {
        showError("Paste JSON with an mcpServers object");
        return;
      }

      for (const [serverName, config] of entries) {
        const type = config?.type === "http" ? "http" : "stdio";
        const headers =
          config?.headers && typeof config.headers === "object"
            ? Object.fromEntries(
                Object.entries(config.headers).map(([key, value]) => [
                  key,
                  String(value ?? ""),
                ]),
              )
            : null;

        if (type === "http") {
          if (!config?.url || typeof config.url !== "string") {
            showError(`${serverName} is missing a URL`);
            return;
          }
          await createServer({
            name: serverName,
            transport: "http",
            url: config.url,
            headersJson: headers,
            enabled: true,
          });
        } else {
          await createServer({
            name: serverName,
            transport: "stdio",
            command:
              typeof config?.command === "string" ? config.command : null,
            args: Array.isArray(config?.args) ? config.args : null,
            envJson:
              config?.env && typeof config.env === "object"
                ? Object.fromEntries(
                    Object.entries(config.env).map(([key, value]) => [
                      key,
                      String(value ?? ""),
                    ]),
                  )
                : null,
            enabled: true,
          });
        }
      }

      setImportConfig("");
      showSuccess(
        `Imported ${entries.length} MCP server${entries.length === 1 ? "" : "s"}`,
      );
      setMcpView("servers");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Invalid MCP JSON");
    }
  };

  const onToggleChatAgentServer = (serverId: number, checked: boolean) => {
    const serverToolKeys = (toolsByServer[serverId] || []).map((tool) =>
      getChatAgentToolKey(serverId, tool.name),
    );
    const serverWorkflowKeys = (workflowsByServer[serverId] || []).map(
      (workflow) => getChatAgentWorkflowKey(serverId, workflow.id),
    );
    const nextIds = checked
      ? Array.from(new Set([...chatAgentMcpServerIds, serverId]))
      : chatAgentMcpServerIds.filter((id) => id !== serverId);
    const nextToolKeys = checked
      ? Array.from(new Set([...chatAgentMcpToolKeys, ...serverToolKeys]))
      : chatAgentMcpToolKeys.filter((key) => !key.startsWith(`${serverId}:`));
    const nextWorkflowKeys = checked
      ? Array.from(
          new Set([...chatAgentMcpWorkflowKeys, ...serverWorkflowKeys]),
        )
      : chatAgentMcpWorkflowKeys.filter(
          (key) => !key.startsWith(`${serverId}:`),
        );

    void updateSettings({
      chatAgentMcpServerIds: nextIds,
      chatAgentMcpToolKeys: nextToolKeys,
      chatAgentMcpWorkflowKeys: nextWorkflowKeys,
    });
  };

  const onToggleChatAgentTool = (
    serverId: number,
    toolName: string,
    checked: boolean,
  ) => {
    const key = getChatAgentToolKey(serverId, toolName);
    const nextToolKeys = checked
      ? Array.from(new Set([...chatAgentMcpToolKeys, key]))
      : chatAgentMcpToolKeys.filter((existingKey) => existingKey !== key);
    const nextServerIds = checked
      ? Array.from(new Set([...chatAgentMcpServerIds, serverId]))
      : chatAgentMcpServerIds;

    void updateSettings({
      chatAgentMcpServerIds: nextServerIds,
      chatAgentMcpToolKeys: nextToolKeys,
    });
  };

  const onToggleChatAgentWorkflow = (
    serverId: number,
    workflowId: string,
    checked: boolean,
  ) => {
    const key = getChatAgentWorkflowKey(serverId, workflowId);
    const nextWorkflowKeys = checked
      ? Array.from(new Set([...chatAgentMcpWorkflowKeys, key]))
      : chatAgentMcpWorkflowKeys.filter((existingKey) => existingKey !== key);
    const nextServerIds = checked
      ? Array.from(new Set([...chatAgentMcpServerIds, serverId]))
      : chatAgentMcpServerIds;

    void updateSettings({
      chatAgentMcpServerIds: nextServerIds,
      chatAgentMcpWorkflowKeys: nextWorkflowKeys,
    });
  };

  const onSetAllChatAgentWorkflows = (
    serverId: number,
    workflowIds: string[],
    checked: boolean,
  ) => {
    const workflowKeys = workflowIds.map((workflowId) =>
      getChatAgentWorkflowKey(serverId, workflowId),
    );
    const nextWorkflowKeys = checked
      ? Array.from(new Set([...chatAgentMcpWorkflowKeys, ...workflowKeys]))
      : chatAgentMcpWorkflowKeys.filter(
          (key) => !key.startsWith(`${serverId}:`),
        );
    const nextServerIds = checked
      ? Array.from(new Set([...chatAgentMcpServerIds, serverId]))
      : chatAgentMcpServerIds;

    void updateSettings({
      chatAgentMcpServerIds: nextServerIds,
      chatAgentMcpWorkflowKeys: nextWorkflowKeys,
    });
  };

  const onSetAllChatAgentTools = (
    serverId: number,
    toolNames: string[],
    checked: boolean,
  ) => {
    const toolKeys = toolNames.map((toolName) =>
      getChatAgentToolKey(serverId, toolName),
    );
    const nextToolKeys = checked
      ? Array.from(new Set([...chatAgentMcpToolKeys, ...toolKeys]))
      : chatAgentMcpToolKeys.filter((key) => !key.startsWith(`${serverId}:`));
    const nextServerIds = checked
      ? Array.from(new Set([...chatAgentMcpServerIds, serverId]))
      : chatAgentMcpServerIds;

    void updateSettings({
      chatAgentMcpServerIds: nextServerIds,
      chatAgentMcpToolKeys: nextToolKeys,
    });
  };

  const onSetToolConsent = async (
    serverId: number,
    toolName: string,
    consent: "ask" | "always" | "denied",
  ) => {
    await updateToolConsent(serverId, toolName, consent);
    setConsents((prev) => ({ ...prev, [`${serverId}:${toolName}`]: consent }));
  };

  // The index, then a page each. Two cards that open somewhere, the way the
  // Storage and Memory sections work, rather than two panels stacked on one
  // screen that the reader has to scroll past each other.
  if (mcpView === "index") {
    return (
      <div className="space-y-4">
        {MCP_DESTINATIONS.map((destination) => (
          <button
            key={destination.id}
            type="button"
            onClick={() => setMcpView(destination.id)}
            className="group flex w-full flex-col gap-5 rounded-2xl border border-cyan-400/15 bg-[rgba(5,16,31,0.72)] p-5 text-left outline-none transition-colors hover:border-cyan-400/35 hover:bg-cyan-500/8 focus-visible:ring-2 focus-visible:ring-cyan-400/60 sm:flex-row sm:items-center"
            data-testid={`mcp-open-${destination.id}`}
          >
            <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-500/8 text-cyan-200">
              <destination.icon className="size-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-lg font-semibold text-white">
                {destination.title}
              </span>
              <span className="mt-1 block text-sm leading-6 text-cyan-100/45">
                {destination.description}
              </span>
              <span className="mt-2 block text-xs font-medium text-cyan-300/70">
                {destination.id === "servers"
                  ? servers.length === 0
                    ? "None configured yet"
                    : `${enabledCount} of ${servers.length} in the chat toolbar`
                  : "Add and configure a server"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-cyan-200/70 transition-colors group-hover:text-cyan-100">
              Open
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    );
  }

  const destination = MCP_DESTINATIONS.find((item) => item.id === mcpView)!;

  return (
    <div className="space-y-5">
      <div className="system-subheader">
        <button
          type="button"
          onClick={() => setMcpView("index")}
          className="system-back"
          data-testid="mcp-back"
        >
          <ChevronLeft className="size-4" />
          MCP
        </button>
        <span className="system-crumb">
          <destination.icon className="size-3.5" />
          {destination.title}
        </span>
      </div>

      {mcpView === "servers" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-cyan-100/45">
                {servers.length === 0
                  ? "No services connected yet."
                  : `${enabledCount} of ${servers.length} available in the chat toolbar.`}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setMcpView("config")}
              data-testid="mcp-add-open"
            >
              <Plus size={14} />
              Add a server
            </Button>
          </div>

          {/* The toggle is the whole contract: on means the wrench in the chat
            bar offers it, off means the wrench does not show it at all. */}
          <p className="text-sm text-muted-foreground">
            A server switched on here appears in the chat toolbar&rsquo;s tools
            menu. Switched off, it stays configured but is hidden there.
          </p>

          <div id={SETTING_IDS.chatAgentMcpServers} className="space-y-1">
            <div className="text-sm font-medium">Chat Agent access</div>
            <div
              id={SETTING_IDS.chatAgentMcpTools}
              className="text-sm text-muted-foreground"
            >
              Select which enabled MCP servers and discovered tools/workflows
              Chat Agent can call. Tool consent still applies before a tool
              runs.
            </div>
          </div>

          <div className="space-y-3">
            {servers.map((s) => (
              <div key={s.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{s.name}</div>
                      <McpConnectionIndicator
                        enabled={!!s.enabled}
                        status={connectionStatuses[s.id]}
                        isChecking={isCheckingConnections}
                      />
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
                  {/* One switch, and it is the one the section is about: does
                    this server appear in the chat toolbar. Everything else
                    moved below, where it cannot be mistaken for this. */}
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <Switch
                        aria-label={`Show ${s.name} in the chat toolbar`}
                        checked={!!s.enabled}
                        onCheckedChange={() =>
                          toggleServerEnabled(s.id, !!s.enabled)
                        }
                      />
                      <span className="text-xs whitespace-nowrap text-muted-foreground">
                        In chat toolbar
                      </span>
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => deleteServer(s.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {s.transport === "stdio" && (
                  <details className="mt-3 rounded-md border bg-muted/20 p-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      Environment variables
                    </summary>
                    <div className="mt-2">
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
                  </details>
                )}
                {s.transport === "http" && (
                  <details className="mt-3 rounded-md border bg-muted/20 p-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      Headers and authentication
                    </summary>
                    <div className="mt-2">
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
                  </details>
                )}
                {(() => {
                  const tools = toolsByServer[s.id] || [];
                  const workflows = workflowsByServer[s.id] || [];
                  const supportsWorkflowDiscovery = tools.some(
                    (tool) => tool.name === "search_workflows",
                  );
                  const selectedToolCount = tools.filter((tool) =>
                    chatAgentMcpToolKeys.includes(
                      getChatAgentToolKey(s.id, tool.name),
                    ),
                  ).length;
                  const selectedWorkflowCount = workflows.filter((workflow) =>
                    chatAgentMcpWorkflowKeys.includes(
                      getChatAgentWorkflowKey(s.id, workflow.id),
                    ),
                  ).length;

                  return (
                    <div className="mt-3 space-y-2">
                      {/* Chat Agent access sits with the tools it governs, not
                        beside the switch that decides chat-toolbar
                        visibility. Two switches side by side read as one
                        setting split in half. */}
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/20 p-2">
                        <Switch
                          aria-label={`Let Chat Agent use ${s.name}`}
                          checked={chatAgentMcpServerIds.includes(s.id)}
                          disabled={!s.enabled}
                          onCheckedChange={(checked) =>
                            onToggleChatAgentServer(s.id, checked)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            Chat Agent may call these tools
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {selectedToolCount} of {tools.length} selected. Tool
                            consent still applies before anything runs.
                          </span>
                        </span>
                      </label>

                      {supportsWorkflowDiscovery && (
                        <CollapsibleMcpSection
                          title="n8n workflows"
                          description="Real workflow records returned by search_workflows. Toggle the workflows Chat Agent may execute."
                          count={workflows.length}
                          selectedCount={selectedWorkflowCount}
                          accent
                          actions={
                            <>
                              {workflows.length > 0 && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!s.enabled}
                                    onClick={() =>
                                      onSetAllChatAgentWorkflows(
                                        s.id,
                                        workflows.map(
                                          (workflow) => workflow.id,
                                        ),
                                        true,
                                      )
                                    }
                                  >
                                    Select all
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!s.enabled}
                                    onClick={() =>
                                      onSetAllChatAgentWorkflows(
                                        s.id,
                                        workflows.map(
                                          (workflow) => workflow.id,
                                        ),
                                        false,
                                      )
                                    }
                                  >
                                    Clear
                                  </Button>
                                </>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!s.enabled}
                                onClick={() => void refetchAll()}
                              >
                                <RefreshCw
                                  size={14}
                                  className={
                                    isCheckingConnections ? "animate-spin" : ""
                                  }
                                />
                                Refresh
                              </Button>
                            </>
                          }
                        >
                          <div id={SETTING_IDS.chatAgentMcpWorkflows} />
                          {workflows.map((workflow) => (
                            <div
                              key={workflow.id}
                              className="flex items-center gap-3 rounded-md border bg-background/60 p-2"
                            >
                              <Switch
                                aria-label={`Use workflow ${workflow.name} with Chat Agent`}
                                checked={chatAgentMcpWorkflowKeys.includes(
                                  getChatAgentWorkflowKey(s.id, workflow.id),
                                )}
                                disabled={
                                  !s.enabled ||
                                  !chatAgentMcpServerIds.includes(s.id)
                                }
                                onCheckedChange={(checked) =>
                                  onToggleChatAgentWorkflow(
                                    s.id,
                                    workflow.id,
                                    checked,
                                  )
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                  {workflow.name}
                                </div>
                                <div className="truncate font-mono text-xs text-muted-foreground">
                                  {workflow.id}
                                  {workflow.active != null
                                    ? workflow.active
                                      ? " · active"
                                      : " · inactive"
                                    : ""}
                                </div>
                                {workflow.description && (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {workflow.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}

                          {workflows.length === 0 && (
                            <div className="text-xs text-muted-foreground">
                              No n8n workflows returned yet. Confirm the server
                              connection, then refresh.
                            </div>
                          )}
                        </CollapsibleMcpSection>
                      )}

                      <CollapsibleMcpSection
                        title="Available MCP tools"
                        description="Server capabilities like search_workflows and execute_workflow."
                        count={tools.length}
                        selectedCount={selectedToolCount}
                        actions={
                          <>
                            {tools.length > 0 && (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!s.enabled}
                                  onClick={() =>
                                    onSetAllChatAgentTools(
                                      s.id,
                                      tools.map((tool) => tool.name),
                                      true,
                                    )
                                  }
                                >
                                  Select all
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!s.enabled}
                                  onClick={() =>
                                    onSetAllChatAgentTools(
                                      s.id,
                                      tools.map((tool) => tool.name),
                                      false,
                                    )
                                  }
                                >
                                  Clear
                                </Button>
                              </>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!s.enabled}
                              onClick={() => void refetchAll()}
                            >
                              <RefreshCw
                                size={14}
                                className={
                                  isCheckingConnections ? "animate-spin" : ""
                                }
                              />
                              Refresh
                            </Button>
                          </>
                        }
                      >
                        {(toolsByServer[s.id] || []).map((t) => (
                          <div key={t.name} className="border rounded p-2">
                            <div className="flex items-center gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-sm truncate">
                                  {t.name}
                                </div>
                                {t.description && (
                                  <div className="mt-1 text-xs text-muted-foreground truncate">
                                    {t.description}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  aria-label={`Use ${t.name} with Chat Agent`}
                                  checked={chatAgentMcpToolKeys.includes(
                                    getChatAgentToolKey(s.id, t.name),
                                  )}
                                  disabled={
                                    !s.enabled ||
                                    !chatAgentMcpServerIds.includes(s.id)
                                  }
                                  onCheckedChange={(checked) =>
                                    onToggleChatAgentTool(s.id, t.name, checked)
                                  }
                                />
                                <span className="text-xs text-muted-foreground">
                                  Chat Agent
                                </span>
                              </div>
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
                                    <SelectItem value="always">
                                      Always allow
                                    </SelectItem>
                                    <SelectItem value="denied">Deny</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        ))}
                        {tools.length === 0 && (
                          <div className="text-xs text-muted-foreground">
                            No tools discovered yet. Check the server URL and
                            headers, then refresh.
                          </div>
                        )}
                      </CollapsibleMcpSection>
                    </div>
                  );
                })()}
              </div>
            ))}
            {servers.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No servers configured yet.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-cyan-100/45">
            Most services publish a config snippet. Paste it and everything is
            filled in for you; the manual fields are there for the ones that do
            not.
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="mcp-import-json">Paste a config snippet</Label>
              <Textarea
                id="mcp-import-json"
                value={importConfig}
                onChange={(e) => setImportConfig(e.target.value)}
                placeholder={
                  '{ "mcpServers": { "n8n-mcp": { "type": "http", "url": "https://...", "headers": { "Authorization": "Bearer ..." } } } }'
                }
                className="mt-1 min-h-24 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Paste an MCP JSON block to add n8n or other HTTP servers with
                their headers.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onImportConfig}
              disabled={!importConfig.trim()}
            >
              <Plus size={14} />
              Add from config
            </Button>
          </div>

          {/* The manual path is second and visibly secondary: it is the
          fallback for services that do not publish a snippet, not the
          route most people should take. */}
          <div className="space-y-2 border-t border-white/10 pt-4">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Or set it up manually
            </div>
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
                <>
                  <div className="col-span-2">
                    <Label>URL</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/mcp-server/http"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Headers / bearer token</Label>
                    <Textarea
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                      placeholder={
                        'Bearer ...\n\nor\n{ "Authorization": "Bearer ..." }'
                      }
                      className="mt-1 min-h-20 font-mono text-xs"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Paste a raw Bearer token, Key: Value header lines, or a
                      JSON object.
                    </p>
                  </div>
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
                <Plus size={14} />
                Add Server
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
