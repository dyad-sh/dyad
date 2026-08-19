import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleOff,
  ExternalLink,
  Loader2,
  Network,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMcp } from "@/hooks/useMcp";
import { ipc, type McpConnectionStatus } from "@/ipc/types";
import {
  buildDesktopMcpServerConfig,
  defaultDesktopMcpPluginDraft,
  DESKTOP_MCP_PLUGIN_DEFINITIONS,
  draftFromDesktopMcpServer,
  isDesktopMcpPluginServer,
  type DesktopMcpConnectionMode,
  type DesktopMcpPluginId,
} from "@/lib/desktop_mcp_plugins";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { BlenderBrandIcon, GodotBrandIcon } from "./DesktopMcpBrandIcons";

function ConnectionStatus({
  enabled,
  status,
  checking,
}: {
  enabled: boolean;
  status?: McpConnectionStatus;
  checking: boolean;
}) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-xs text-muted-foreground">
        <CircleOff className="size-3.5" /> Disabled
      </span>
    );
  }
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-2.5 py-1 text-xs text-cyan-500">
        <Loader2 className="size-3.5 animate-spin" /> Checking
      </span>
    );
  }
  if (status?.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-1 text-xs text-emerald-500">
        <CheckCircle2 className="size-3.5" /> Connected
        {status.toolCount != null ? ` · ${status.toolCount} tools` : ""}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/8 px-2.5 py-1 text-xs text-amber-500"
      title={status?.error}
    >
      <AlertCircle className="size-3.5" /> Software offline
    </span>
  );
}

export function DesktopMcpPluginSettings({
  plugin,
}: {
  plugin: DesktopMcpPluginId;
}) {
  const definition = DESKTOP_MCP_PLUGIN_DEFINITIONS[plugin];
  const {
    servers,
    connectionStatuses,
    createServer,
    updateServer,
    toggleEnabled,
    deleteServer,
    refetchAll,
  } = useMcp();
  const server = useMemo(
    () => servers.find((item) => isDesktopMcpPluginServer(plugin, item)),
    [plugin, servers],
  );
  const [draft, setDraft] = useState(() =>
    defaultDesktopMcpPluginDraft(plugin),
  );
  const [manualStatus, setManualStatus] = useState<McpConnectionStatus>();
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    setDraft(
      server
        ? draftFromDesktopMcpServer(plugin, server)
        : defaultDesktopMcpPluginDraft(plugin),
    );
    setManualStatus(undefined);
  }, [plugin, server]);

  const status = server
    ? (manualStatus ?? connectionStatuses[server.id])
    : undefined;
  const BrandIcon = plugin === "godot" ? GodotBrandIcon : BlenderBrandIcon;
  const installed = Boolean(server);
  const setupGuideUrl =
    plugin === "godot" && draft.mode === "remote"
      ? "https://github.com/Fulviuus/godot-mcp"
      : definition.repositoryUrl;

  const patchDraft = <Key extends keyof typeof draft>(
    key: Key,
    value: (typeof draft)[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const checkConnection = async (serverId = server?.id) => {
    if (!serverId) return;
    setIsChecking(true);
    try {
      const nextStatus = await ipc.mcp.checkConnection(serverId);
      setManualStatus(nextStatus);
      if (nextStatus.ok) {
        showSuccess(`${definition.title} MCP is connected.`);
      } else {
        showInfo(
          `${definition.title} is configured, but the software bridge is not available yet.`,
        );
      }
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : `Could not test ${definition.title} MCP.`,
      );
    } finally {
      setIsChecking(false);
    }
  };

  const saveConnection = async () => {
    setIsSaving(true);
    try {
      const config = buildDesktopMcpServerConfig(plugin, draft);
      const saved = server
        ? await updateServer({
            id: server.id,
            name: config.name,
            transport: config.transport,
            command: config.command ?? "",
            args: JSON.stringify(Array.isArray(config.args) ? config.args : []),
            envJson: config.envJson ?? "",
            url: config.url ?? "",
            enabled: true,
          })
        : await createServer(config);
      showSuccess(
        `${definition.title} MCP ${server ? "configuration saved" : "installed"}.`,
      );
      await refetchAll();
      await checkConnection(saved.id);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : `Could not install ${definition.title} MCP.`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const changeMode = (mode: DesktopMcpConnectionMode) => {
    patchDraft("mode", mode);
    setManualStatus(undefined);
  };

  const handleToggle = async () => {
    if (!server) return;
    try {
      await toggleEnabled(server.id, server.enabled);
      setManualStatus(undefined);
      await refetchAll();
      showSuccess(
        `${definition.title} MCP ${server.enabled ? "disabled" : "enabled"}.`,
      );
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : `Could not update ${definition.title} MCP.`,
      );
    }
  };

  const handleRemove = async () => {
    if (!server) return;
    try {
      await deleteServer(server.id);
      setRemoveOpen(false);
      await refetchAll();
      showSuccess(`${definition.title} MCP configuration removed.`);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : `Could not remove ${definition.title} MCP.`,
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={
              plugin === "godot"
                ? "grid size-11 shrink-0 place-items-center rounded-xl bg-[#478CBF]/12 text-[#478CBF]"
                : "grid size-11 shrink-0 place-items-center rounded-xl bg-[#E87D0D]/12 text-[#E87D0D]"
            }
          >
            <BrandIcon className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {installed
                ? `${definition.title} MCP installed`
                : `Install ${definition.title} MCP`}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {plugin === "godot"
                ? "Let the Chat Agent inspect projects, create scenes, run games and read debug output."
                : "Let the Chat Agent inspect scenes, model objects, edit materials, render and use Blender Python."}
            </p>
          </div>
        </div>
        {installed && (
          <ConnectionStatus
            enabled={server?.enabled ?? false}
            status={status}
            checking={isChecking || !status}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/35 p-1">
        {(["local", "remote"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={draft.mode === mode}
            className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            onClick={() => changeMode(mode)}
          >
            {mode === "local" ? "This machine" : "Another machine"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {plugin === "godot" && draft.mode === "remote" ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="godot-remote-mcp-url">Remote MCP address</Label>
            <Input
              id="godot-remote-mcp-url"
              value={draft.remoteMcpUrl}
              onChange={(event) =>
                patchDraft("remoteMcpUrl", event.currentTarget.value)
              }
              placeholder="http://studio-pc:7878/mcp"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Run a Streamable HTTP Godot MCP server on that machine and use a
              private network or SSH tunnel.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${plugin}-mcp-command`}>
                {plugin === "godot" ? "npx command" : "uvx command"}
              </Label>
              <Input
                id={`${plugin}-mcp-command`}
                value={draft.command}
                onChange={(event) =>
                  patchDraft("command", event.currentTarget.value)
                }
                placeholder={plugin === "godot" ? "npx" : "uvx"}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            {plugin === "godot" ? (
              <div className="space-y-1.5">
                <Label htmlFor="godot-executable-path">
                  Godot executable path
                </Label>
                <Input
                  id="godot-executable-path"
                  value={draft.executablePath}
                  onChange={(event) =>
                    patchDraft("executablePath", event.currentTarget.value)
                  }
                  placeholder="Optional — detected automatically"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
            ) : (
              <>
                {draft.mode === "remote" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="blender-remote-host">Blender machine</Label>
                    <Input
                      id="blender-remote-host"
                      value={draft.remoteHost}
                      onChange={(event) =>
                        patchDraft("remoteHost", event.currentTarget.value)
                      }
                      placeholder="192.168.1.80 or studio-pc"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="blender-remote-port">
                    Blender add-on port
                  </Label>
                  <Input
                    id="blender-remote-port"
                    inputMode="numeric"
                    value={draft.remotePort}
                    onChange={(event) =>
                      patchDraft("remotePort", event.currentTarget.value)
                    }
                    placeholder="9876"
                    className="font-mono text-xs"
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {plugin === "blender" && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-3 py-2.5">
          <div>
            <Label htmlFor="blender-disable-telemetry">
              Disable Blender MCP telemetry
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recommended for private project work.
            </p>
          </div>
          <Switch
            id="blender-disable-telemetry"
            checked={draft.disableTelemetry}
            onCheckedChange={(checked) =>
              patchDraft("disableTelemetry", checked)
            }
          />
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-xs leading-5 text-muted-foreground">
          This community MCP can execute{" "}
          {plugin === "godot" ? "GDScript" : "Python"} and modify project files.
          Keep remote ports private and review Chat Agent tool approvals before
          allowing changes.
        </p>
      </div>

      {status && !status.ok && installed && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/25 p-3">
          <Network className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium text-foreground">
              MCP installed; editor bridge unavailable
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {status.error ||
                `Start ${definition.title} and its MCP bridge, then test again.`}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={isSaving || isChecking}
          onClick={() => void saveConnection()}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : installed ? (
            <RefreshCw className="size-4" />
          ) : (
            <Power className="size-4" />
          )}
          {isSaving
            ? "Installing…"
            : installed
              ? "Save & test"
              : "Install & test"}
        </Button>
        {installed && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving || isChecking}
              onClick={() => void checkConnection()}
            >
              {isChecking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Test
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleToggle()}
            >
              <Power className="size-4" />
              {server?.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => void ipc.system.openExternalUrl(setupGuideUrl)}
        >
          Setup guide <ExternalLink className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void ipc.system.openExternalUrl(definition.softwareUrl)
          }
        >
          Get {definition.title} <ExternalLink className="size-3.5" />
        </Button>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        Installing adds this preset to the shared MCP server list. Its tools
        remain subject to the app&apos;s per-tool permission controls.
      </p>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {definition.title} MCP?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the connection and its saved tool configuration from
              Meta Human OS. It does not uninstall {definition.title} or delete
              project files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleRemove()}
            >
              Remove connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
