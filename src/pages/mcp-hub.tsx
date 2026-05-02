import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Search,
  Plus,
  Star,
  ExternalLink,
  Github,
  CheckCircle2,
  Loader2,
  Server,
  Zap,
  Shield,
  Globe,
  Database,
  Cloud,
  Code2,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  Sparkles,
  Plug,
  Trash2,
  ChevronDown,
  Terminal,
  Link,
  RefreshCw,
  Wrench,
  Power,
  PowerOff,
  AlertCircle,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useMcp, type Transport } from "@/hooks/useMcp";
import type { McpServerStatusInfo } from "@/ipc/ipc_types";
import { showError, showSuccess } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import {
  MCP_CATEGORIES,
  type McpServerRegistryEntry,
  type McpServerCategory,
  getFeaturedServers,
  getServersByCategory,
  searchServers,
} from "@/data/mcp_server_registry";
import type { McpServer, McpTool } from "@/ipc/ipc_types";

// Icon mapping for categories
const categoryIcons: Record<McpServerCategory, React.ReactNode> = {
  featured: <Star className="h-4 w-4" />,
  "ai-assistants": <Sparkles className="h-4 w-4" />,
  development: <Code2 className="h-4 w-4" />,
  "code-platforms": <Server className="h-4 w-4" />,
  databases: <Database className="h-4 w-4" />,
  "cloud-services": <Cloud className="h-4 w-4" />,
  deployment: <Zap className="h-4 w-4" />,
  "browser-automation": <Globe className="h-4 w-4" />,
  analytics: <BarChart3 className="h-4 w-4" />,
  documentation: <FileText className="h-4 w-4" />,
  productivity: <Settings className="h-4 w-4" />,
  "data-processing": <Database className="h-4 w-4" />,
  communication: <MessageSquare className="h-4 w-4" />,
  other: <Plug className="h-4 w-4" />,
};

interface InstallDialogState {
  isOpen: boolean;
  server: McpServerRegistryEntry | null;
  envValues: Record<string, string>;
  isInstalling: boolean;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
const McpHubPage: React.FC = () => {
  const router = useRouter();
  const {
    servers: installedServers,
    toolsByServer,
    consentsMap,
    statusByServer,
    resourcesByServer,
    promptsByServer,
    isLoading,
    createServer,
    toggleEnabled,
    deleteServer,
    updateServer,
    setToolConsent,
    refetchAll,
    connectServer,
    disconnectServer,
    reconnectServer,
    reconnectAll,
    readResource,
    getPrompt,
    isCreating,
    isUpdatingServer,
    isDeleting,
    isReadingResource,
    isGettingPrompt,
  } = useMcp();

  const [topTab, setTopTab] = useState<
    "my-servers" | "registry" | "custom" | "resources" | "prompts"
  >("my-servers");
  const [otherSettingsOpen, setOtherSettingsOpen] = useState(false);
  // Resource viewer dialog
  const [resourceViewer, setResourceViewer] = useState<{
    open: boolean;
    serverId?: number;
    uri?: string;
    name?: string;
    content?: string;
    error?: string;
  }>({ open: false });
  // Prompt runner dialog
  const [promptRunner, setPromptRunner] = useState<{
    open: boolean;
    serverId?: number;
    name?: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
    values: Record<string, string>;
    result?: unknown;
    error?: string;
  }>({ open: false, values: {} });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<McpServerCategory>("featured");

  // Registry install dialog
  const [installDialog, setInstallDialog] = useState<InstallDialogState>({
    isOpen: false,
    server: null,
    envValues: {},
    isInstalling: false,
  });

  // Custom server form
  const [customName, setCustomName] = useState("");
  const [customTransport, setCustomTransport] = useState<Transport>("stdio");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customEnabled, setCustomEnabled] = useState(true);

  // Installed server name set for registry "installed" badges
  const installedServerIds = useMemo(() => {
    return new Set(installedServers?.map((s) => s.name.toLowerCase()) ?? []);
  }, [installedServers]);

  // Registry search/filter
  const displayedServers = useMemo(() => {
    if (searchQuery.trim()) return searchServers(searchQuery);
    return getServersByCategory(selectedCategory);
  }, [searchQuery, selectedCategory]);

  const featuredServers = useMemo(() => getFeaturedServers(), []);

  // ------- Registry install flow -------
  const handleInstallClick = (server: McpServerRegistryEntry) => {
    const envValues: Record<string, string> = {};
    server.envVars?.forEach((envVar) => {
      envValues[envVar.key] = "";
    });
    setInstallDialog({ isOpen: true, server, envValues, isInstalling: false });
  };

  const handleInstall = async () => {
    const { server, envValues } = installDialog;
    if (!server) return;
    const missingVars = server.envVars?.filter(
      (v) => v.required && !envValues[v.key]?.trim(),
    );
    if (missingVars && missingVars.length > 0) {
      showError(`Missing required: ${missingVars.map((v) => v.key).join(", ")}`);
      return;
    }
    setInstallDialog((prev) => ({ ...prev, isInstalling: true }));
    try {
      const config = server.config;
      let command: string | null = null;
      let args: string[] | null = null;
      let url: string | null = null;
      if (config.type === "stdio" && config.command) {
        const parts = config.command.split(" ");
        command = parts[0];
        args = parts.slice(1);
      } else if (config.type === "http" && config.url) {
        url = config.url;
      }
      const envJson =
        Object.keys(envValues).length > 0
          ? { ...config.env, ...envValues }
          : config.env || null;

      // Special-case: n8n entries need a live MCP Server Trigger workflow
      // before the URL will respond. Auto-provision it via n8n's API so the
      // user never has to leave the MCP Hub.
      if (server.id === "n8n-local") {
        try {
          const ipc = IpcClient.getInstance();
          const apiKey = envValues["X-N8N-API-KEY"]?.trim();
          const result = await ipc.ensureN8nMcpTrigger({
            path: "joycreate",
            name: "JoyCreate MCP Server",
            apiKey,
          });
          url = result.url;
          showSuccess(
            result.created
              ? `Created n8n MCP trigger workflow → ${result.url}`
              : `Reusing existing n8n MCP trigger → ${result.url}`,
          );
        } catch (err) {
          showError(
            `Could not provision n8n MCP workflow: ${
              err instanceof Error ? err.message : "Unknown error"
            }`,
          );
          setInstallDialog((prev) => ({ ...prev, isInstalling: false }));
          return;
        }
      }

      await createServer({
        name: server.name,
        transport: config.type,
        command,
        args,
        url,
        envJson: envJson && Object.keys(envJson).length > 0 ? envJson : null,
        enabled: true,
      });
      showSuccess(`${server.name} installed successfully!`);
      setInstallDialog({ isOpen: false, server: null, envValues: {}, isInstalling: false });
      setTopTab("my-servers");
    } catch (error) {
      showError(`Failed to install: ${error instanceof Error ? error.message : "Unknown error"}`);
      setInstallDialog((prev) => ({ ...prev, isInstalling: false }));
    }
  };

  const isServerInstalled = (server: McpServerRegistryEntry) =>
    installedServerIds.has(server.name.toLowerCase());

  // ------- Custom server creation -------
  const handleCreateCustom = async () => {
    if (!customName.trim()) {
      showError("Server name is required");
      return;
    }
    if (customTransport === "stdio" && !customCommand.trim()) {
      showError("Command is required for stdio transport");
      return;
    }
    if (customTransport === "http" && !customUrl.trim()) {
      showError("URL is required for HTTP transport");
      return;
    }
    try {
      const parsedArgs = (() => {
        const trimmed = customArgs.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("[")) {
          try {
            const arr = JSON.parse(trimmed);
            return Array.isArray(arr) && arr.every((x: unknown) => typeof x === "string")
              ? (arr as string[])
              : null;
          } catch {
            /* fall through */
          }
        }
        return trimmed.split(" ").filter(Boolean);
      })();

      await createServer({
        name: customName.trim(),
        transport: customTransport,
        command: customTransport === "stdio" ? customCommand.trim() : null,
        args: customTransport === "stdio" ? parsedArgs : null,
        url: customTransport === "http" ? customUrl.trim() : null,
        envJson: null,
        enabled: customEnabled,
      });
      showSuccess(`${customName} server added!`);
      setCustomName("");
      setCustomCommand("");
      setCustomArgs("");
      setCustomUrl("");
      setCustomEnabled(true);
      setTopTab("my-servers");
    } catch (error) {
      showError(`Failed to add: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // ------- Counts for tab badges -------
  const enabledCount = installedServers.filter((s) => s.enabled).length;
  const totalTools = Object.values(toolsByServer).reduce((sum, tools) => sum + tools.length, 0);

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button onClick={() => router.history.back()} variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Plug className="h-6 w-6 text-primary" />
                  MCP Hub
                </h1>
                <p className="text-sm text-muted-foreground">
                  Connect, manage, and discover MCP servers
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Stats badges */}
              <Badge variant="outline" className="gap-1.5 py-1">
                <Server className="h-3.5 w-3.5" />
                {installedServers.length} server{installedServers.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="gap-1.5 py-1">
                <Power className="h-3.5 w-3.5 text-green-500" />
                {enabledCount} active
              </Badge>
              <Badge variant="outline" className="gap-1.5 py-1">
                <Wrench className="h-3.5 w-3.5" />
                {totalTools} tool{totalTools !== 1 ? "s" : ""}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await refetchAll();
                  if (installedServers.length > 0) {
                    await reconnectAll(installedServers.map((s) => s.id));
                  }
                }}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh All
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top-level Tabs ────────────────────────────────────────── */}
      <div className="mx-auto px-6 py-6">
        {/* Other Settings deep-link cards */}
        <Collapsible
          open={otherSettingsOpen}
          onOpenChange={setOtherSettingsOpen}
          className="mb-6"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-4 py-2 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Other Settings
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${otherSettingsOpen ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  hash: "provider-settings",
                  title: "AI Providers",
                  desc: "Configure model API keys and providers",
                  icon: <Sparkles className="h-4 w-4" />,
                },
                {
                  hash: "integrations",
                  title: "Integrations",
                  desc: "GitHub, Vercel, Supabase, Neon",
                  icon: <Github className="h-4 w-4" />,
                },
                {
                  hash: "external-services",
                  title: "External Services",
                  desc: "Third-party service connections",
                  icon: <Cloud className="h-4 w-4" />,
                },
                {
                  hash: "agent-permissions",
                  title: "Agent Permissions",
                  desc: "Control local agent tool access",
                  icon: <Shield className="h-4 w-4" />,
                },
                {
                  hash: "cns-settings",
                  title: "CNS",
                  desc: "Decentralized chat settings",
                  icon: <MessageSquare className="h-4 w-4" />,
                },
                {
                  hash: "joy-identity",
                  title: "Joy Identity",
                  desc: "Wallet and identity",
                  icon: <Database className="h-4 w-4" />,
                },
              ].map((card) => (
                <button
                  key={card.hash}
                  type="button"
                  onClick={() =>
                    router.navigate({
                      to: "/settings",
                      hash: card.hash,
                    } as any)
                  }
                  className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{card.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {card.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as typeof topTab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="my-servers" className="gap-2">
              <Server className="h-4 w-4" />
              My Servers
              {installedServers.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{installedServers.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="registry" className="gap-2">
              <Star className="h-4 w-4" />
              Registry
            </TabsTrigger>
            <TabsTrigger value="custom" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Custom
            </TabsTrigger>
            <TabsTrigger value="resources" className="gap-2">
              <FileText className="h-4 w-4" />
              Resources
            </TabsTrigger>
            <TabsTrigger value="prompts" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Prompts
            </TabsTrigger>
          </TabsList>

          {/* ═══════════ MY SERVERS ═══════════ */}
          <TabsContent value="my-servers" className="mt-0 space-y-4">
            {installedServers.length === 0 ? (
              <div className="text-center py-16 space-y-4">
                <Server className="h-16 w-16 mx-auto text-muted-foreground/30" />
                <div>
                  <p className="text-lg font-medium text-muted-foreground">No MCP servers connected</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Browse the registry or add a custom server to get started.
                  </p>
                </div>
                <div className="flex justify-center gap-3">
                  <Button onClick={() => setTopTab("registry")}>
                    <Star className="h-4 w-4 mr-2" />
                    Browse Registry
                  </Button>
                  <Button variant="outline" onClick={() => setTopTab("custom")}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Custom
                  </Button>
                </div>
              </div>
            ) : (
              installedServers.map((server) => (
                <InstalledServerCard
                  key={server.id}
                  server={server}
                  tools={toolsByServer[server.id] || []}
                  consentsMap={consentsMap}
                  status={
                    statusByServer[server.id] ?? {
                      serverId: server.id,
                      status: "disconnected",
                    }
                  }
                  onConnect={() => connectServer(server.id)}
                  onDisconnect={() => disconnectServer(server.id)}
                  onReconnect={() => reconnectServer(server.id)}
                  onToggleEnabled={() => toggleEnabled(server.id, !!server.enabled)}
                  onDelete={() => deleteServer(server.id)}
                  onSetConsent={(toolName, consent) => setToolConsent(server.id, toolName, consent)}
                  onUpdateEnv={async (envJson) => {
                    await updateServer({ id: server.id, envJson });
                  }}
                  isUpdating={isUpdatingServer}
                  isDeleting={isDeleting}
                />
              ))
            )}
          </TabsContent>

          {/* ═══════════ REGISTRY ═══════════ */}
          <TabsContent value="registry" className="mt-0">
            {/* Search bar */}
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search MCP servers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 max-w-md"
              />
            </div>

            {/* Featured (when no search, on featured tab) */}
            {!searchQuery.trim() && selectedCategory === "featured" && (
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <h2 className="text-xl font-semibold">Featured Servers</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {featuredServers.map((server) => (
                    <RegistryServerCard
                      key={server.id}
                      server={server}
                      isInstalled={isServerInstalled(server)}
                      onInstall={() => handleInstallClick(server)}
                      featured
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Category pills */}
            <Tabs
              value={selectedCategory}
              onValueChange={(v) => setSelectedCategory(v as McpServerCategory)}
              className="w-full"
            >
              <TabsList className="w-full h-auto flex-wrap gap-1 bg-transparent p-0 mb-6">
                {MCP_CATEGORIES.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 py-1.5 rounded-full border"
                  >
                    {categoryIcons[category.id]}
                    <span>{category.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {searchQuery.trim() ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {displayedServers.length} result{displayedServers.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayedServers.map((server) => (
                      <RegistryServerCard
                        key={server.id}
                        server={server}
                        isInstalled={isServerInstalled(server)}
                        onInstall={() => handleInstallClick(server)}
                      />
                    ))}
                  </div>
                  {displayedServers.length === 0 && (
                    <div className="text-center py-12">
                      <Search className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">No servers found.</p>
                    </div>
                  )}
                </div>
              ) : (
                MCP_CATEGORIES.map((category) => (
                  <TabsContent key={category.id} value={category.id} className="mt-0">
                    {category.id !== "featured" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {getServersByCategory(category.id).map((server) => (
                          <RegistryServerCard
                            key={server.id}
                            server={server}
                            isInstalled={isServerInstalled(server)}
                            onInstall={() => handleInstallClick(server)}
                          />
                        ))}
                      </div>
                    )}
                    {category.id !== "featured" && getServersByCategory(category.id).length === 0 && (
                      <div className="text-center py-12">
                        <Server className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">No servers in this category yet.</p>
                      </div>
                    )}
                  </TabsContent>
                ))
              )}
            </Tabs>
          </TabsContent>

          {/* ═══════════ ADD CUSTOM SERVER ═══════════ */}
          <TabsContent value="custom" className="mt-0">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5" />
                  Add Custom MCP Server
                </CardTitle>
                <CardDescription>
                  Connect any MCP-compatible server via stdio (local command) or HTTP (remote URL).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="custom-name">Server Name</Label>
                  <Input
                    id="custom-name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="My Custom MCP Server"
                  />
                </div>

                {/* Transport */}
                <div className="space-y-2">
                  <Label>Transport</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCustomTransport("stdio")}
                      className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-all ${
                        customTransport === "stdio"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-muted-foreground/30"
                      }`}
                    >
                      <Terminal className="h-5 w-5 shrink-0" />
                      <div>
                        <div className="font-medium">stdio</div>
                        <div className="text-xs text-muted-foreground">Run a local command</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomTransport("http")}
                      className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-all ${
                        customTransport === "http"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-muted-foreground/30"
                      }`}
                    >
                      <Link className="h-5 w-5 shrink-0" />
                      <div>
                        <div className="font-medium">HTTP</div>
                        <div className="text-xs text-muted-foreground">Connect to a URL</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* stdio fields */}
                {customTransport === "stdio" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="custom-command">Command</Label>
                      <Input
                        id="custom-command"
                        value={customCommand}
                        onChange={(e) => setCustomCommand(e.target.value)}
                        placeholder="npx, node, python, etc."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-args">Arguments</Label>
                      <Input
                        id="custom-args"
                        value={customArgs}
                        onChange={(e) => setCustomArgs(e.target.value)}
                        placeholder="-y @scope/mcp-server@latest"
                      />
                    </div>
                  </div>
                )}

                {/* http field */}
                {customTransport === "http" && (
                  <div className="space-y-2">
                    <Label htmlFor="custom-url">Server URL</Label>
                    <Input
                      id="custom-url"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="http://localhost:3000/mcp"
                    />
                  </div>
                )}

                {/* Enabled toggle */}
                <div className="flex items-center gap-3">
                  <Switch checked={customEnabled} onCheckedChange={setCustomEnabled} />
                  <Label>Enable immediately</Label>
                </div>
              </CardContent>
              <CardFooter>
                <Button onClick={handleCreateCustom} disabled={isCreating || !customName.trim()}>
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Server
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>

            {/* Helpful examples */}
            <div className="mt-8 max-w-2xl">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Quick Examples</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { name: "Custom NPX Server", transport: "stdio" as Transport, cmd: "npx", args: "-y @your-org/mcp-server@latest", desc: "Run any published npm MCP package" },
                  { name: "Python MCP", transport: "stdio" as Transport, cmd: "python", args: "-m my_mcp_server", desc: "Launch a Python-based MCP server" },
                  { name: "Local HTTP Server", transport: "http" as Transport, url: "http://localhost:3000/mcp", desc: "Connect to a locally running server" },
                  { name: "Remote MCP Endpoint", transport: "http" as Transport, url: "https://api.example.com/mcp", desc: "Connect to a hosted MCP service" },
                ].map((ex) => (
                  <button
                    key={ex.name}
                    type="button"
                    onClick={() => {
                      setCustomName(ex.name);
                      setCustomTransport(ex.transport);
                      if (ex.transport === "stdio") {
                        setCustomCommand(ex.cmd || "");
                        setCustomArgs(ex.args || "");
                      } else {
                        setCustomUrl(ex.url || "");
                      }
                    }}
                    className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-left hover:border-primary/50 hover:bg-primary/5 transition-all"
                  >
                    {ex.transport === "stdio" ? (
                      <Terminal className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Globe className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{ex.name}</div>
                      <div className="text-xs text-muted-foreground">{ex.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ═══════════ RESOURCES ═══════════ */}
          <TabsContent value="resources" className="mt-0 space-y-4">
            {installedServers.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                Add an MCP server to browse its resources.
              </div>
            ) : (
              installedServers.map((server) => {
                const status = statusByServer[server.id]?.status;
                const bundle = resourcesByServer[server.id];
                return (
                  <Card key={server.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {server.name}
                        <StatusBadge
                          status={
                            statusByServer[server.id] ?? {
                              serverId: server.id,
                              status: "disconnected",
                            }
                          }
                        />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {status !== "connected" ? (
                        <p className="text-sm text-muted-foreground">
                          Connect this server to discover resources.
                        </p>
                      ) : !bundle ||
                        (bundle.resources.length === 0 &&
                          bundle.templates.length === 0) ? (
                        <p className="text-sm text-muted-foreground">
                          No resources exposed by this server.
                        </p>
                      ) : (
                        <>
                          {bundle.resources.map((res: any) => (
                            <div
                              key={res.uri}
                              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-xs truncate">
                                  {res.uri}
                                </div>
                                {res.name && (
                                  <div className="text-sm">{res.name}</div>
                                )}
                                {res.description && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {res.description}
                                  </div>
                                )}
                                {res.mimeType && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] mt-1"
                                  >
                                    {res.mimeType}
                                  </Badge>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isReadingResource}
                                onClick={async () => {
                                  setResourceViewer({
                                    open: true,
                                    serverId: server.id,
                                    uri: res.uri,
                                    name: res.name,
                                  });
                                  try {
                                    const result: any = await readResource({
                                      serverId: server.id,
                                      uri: res.uri,
                                    });
                                    const text =
                                      result?.contents
                                        ?.map((c: any) =>
                                          c.text ?? c.blob ?? JSON.stringify(c),
                                        )
                                        .join("\n\n") ??
                                      JSON.stringify(result, null, 2);
                                    setResourceViewer((prev) => ({
                                      ...prev,
                                      content: text,
                                    }));
                                  } catch (err) {
                                    setResourceViewer((prev) => ({
                                      ...prev,
                                      error:
                                        err instanceof Error
                                          ? err.message
                                          : String(err),
                                    }));
                                  }
                                }}
                              >
                                Read
                              </Button>
                            </div>
                          ))}
                          {bundle.templates.length > 0 && (
                            <div className="pt-2">
                              <div className="text-xs font-medium text-muted-foreground mb-1">
                                Resource Templates
                              </div>
                              {bundle.templates.map((tpl: any) => (
                                <div
                                  key={tpl.uriTemplate}
                                  className="rounded-md border px-3 py-2 mb-1"
                                >
                                  <div className="font-mono text-xs truncate">
                                    {tpl.uriTemplate}
                                  </div>
                                  {tpl.name && (
                                    <div className="text-sm">{tpl.name}</div>
                                  )}
                                  {tpl.description && (
                                    <div className="text-xs text-muted-foreground">
                                      {tpl.description}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          {/* ═══════════ PROMPTS ═══════════ */}
          <TabsContent value="prompts" className="mt-0 space-y-4">
            {installedServers.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                Add an MCP server to browse its prompts.
              </div>
            ) : (
              installedServers.map((server) => {
                const status = statusByServer[server.id]?.status;
                const prompts = promptsByServer[server.id] ?? [];
                return (
                  <Card key={server.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        {server.name}
                        <StatusBadge
                          status={
                            statusByServer[server.id] ?? {
                              serverId: server.id,
                              status: "disconnected",
                            }
                          }
                        />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {status !== "connected" ? (
                        <p className="text-sm text-muted-foreground">
                          Connect this server to discover prompts.
                        </p>
                      ) : prompts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No prompts exposed by this server.
                        </p>
                      ) : (
                        prompts.map((p: any) => (
                          <div
                            key={p.name}
                            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm truncate">
                                {p.name}
                              </div>
                              {p.description && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {p.description}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const argDefs: Array<{
                                  name: string;
                                  description?: string;
                                  required?: boolean;
                                }> = (p.arguments ?? []).map((a: any) => ({
                                  name: a.name,
                                  description: a.description,
                                  required: !!a.required,
                                }));
                                if (argDefs.length === 0) {
                                  // No args — invoke immediately and show result
                                  setPromptRunner({
                                    open: true,
                                    serverId: server.id,
                                    name: p.name,
                                    description: p.description,
                                    arguments: argDefs,
                                    values: {},
                                  });
                                  getPrompt({
                                    serverId: server.id,
                                    name: p.name,
                                  })
                                    .then((result) =>
                                      setPromptRunner((prev) => ({
                                        ...prev,
                                        result,
                                      })),
                                    )
                                    .catch((err) =>
                                      setPromptRunner((prev) => ({
                                        ...prev,
                                        error:
                                          err instanceof Error
                                            ? err.message
                                            : String(err),
                                      })),
                                    );
                                } else {
                                  setPromptRunner({
                                    open: true,
                                    serverId: server.id,
                                    name: p.name,
                                    description: p.description,
                                    arguments: argDefs,
                                    values: {},
                                  });
                                }
                              }}
                            >
                              Run
                            </Button>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Registry Install Dialog ──────────────────────────────── */}
      <Dialog
        open={installDialog.isOpen}
        onOpenChange={(open) => {
          if (!open && !installDialog.isInstalling) {
            setInstallDialog({ isOpen: false, server: null, envValues: {}, isInstalling: false });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Install {installDialog.server?.name}
            </DialogTitle>
            <DialogDescription>{installDialog.server?.description}</DialogDescription>
          </DialogHeader>

          {installDialog.server?.envVars && installDialog.server.envVars.length > 0 && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>This server requires authentication</span>
              </div>
              {installDialog.server.envVars.map((envVar) => (
                <div key={envVar.key} className="space-y-2">
                  <Label htmlFor={envVar.key} className="flex items-center gap-1">
                    {envVar.key}
                    {envVar.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id={envVar.key}
                    type="password"
                    placeholder={envVar.placeholder || `Enter ${envVar.key}`}
                    value={installDialog.envValues[envVar.key] || ""}
                    onChange={(e) =>
                      setInstallDialog((prev) => ({
                        ...prev,
                        envValues: { ...prev.envValues, [envVar.key]: e.target.value },
                      }))
                    }
                    disabled={installDialog.isInstalling}
                  />
                  {envVar.description && (
                    <p className="text-xs text-muted-foreground">{envVar.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!installDialog.server?.envVars?.length && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                No configuration needed. Click install to add it.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setInstallDialog({ isOpen: false, server: null, envValues: {}, isInstalling: false })
              }
              disabled={installDialog.isInstalling}
            >
              Cancel
            </Button>
            <Button onClick={handleInstall} disabled={installDialog.isInstalling}>
              {installDialog.isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Install
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resource Viewer Dialog ───────────────────────────────── */}
      <Dialog
        open={resourceViewer.open}
        onOpenChange={(open) =>
          setResourceViewer((prev) =>
            open ? prev : { open: false },
          )
        }
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {resourceViewer.name || resourceViewer.uri || "Resource"}
            </DialogTitle>
            {resourceViewer.uri && (
              <DialogDescription className="font-mono text-xs">
                {resourceViewer.uri}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded border bg-muted/30 p-3">
            {resourceViewer.error ? (
              <div className="text-sm text-destructive">
                {resourceViewer.error}
              </div>
            ) : resourceViewer.content === undefined ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                {resourceViewer.content}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Prompt Runner Dialog ─────────────────────────────────── */}
      <Dialog
        open={promptRunner.open}
        onOpenChange={(open) =>
          setPromptRunner((prev) =>
            open ? prev : { open: false, values: {} },
          )
        }
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              {promptRunner.name}
            </DialogTitle>
            {promptRunner.description && (
              <DialogDescription>
                {promptRunner.description}
              </DialogDescription>
            )}
          </DialogHeader>

          {promptRunner.result === undefined && !promptRunner.error && (
            <div className="space-y-3 py-2">
              {(promptRunner.arguments ?? []).map((arg) => (
                <div key={arg.name} className="space-y-1">
                  <Label className="flex items-center gap-1">
                    {arg.name}
                    {arg.required && <span className="text-red-500">*</span>}
                  </Label>
                  {arg.description && (
                    <p className="text-xs text-muted-foreground">
                      {arg.description}
                    </p>
                  )}
                  <Input
                    value={promptRunner.values[arg.name] ?? ""}
                    onChange={(e) =>
                      setPromptRunner((prev) => ({
                        ...prev,
                        values: { ...prev.values, [arg.name]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
              {(promptRunner.arguments ?? []).length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Running prompt…
                </div>
              )}
            </div>
          )}

          {promptRunner.error && (
            <div className="text-sm text-destructive py-2">
              {promptRunner.error}
            </div>
          )}

          {promptRunner.result !== undefined && (
            <div className="max-h-[50vh] overflow-auto rounded border bg-muted/30 p-3">
              <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                {JSON.stringify(promptRunner.result, null, 2)}
              </pre>
            </div>
          )}

          <DialogFooter>
            {(promptRunner.arguments ?? []).length > 0 &&
              promptRunner.result === undefined && (
                <Button
                  onClick={async () => {
                    if (!promptRunner.serverId || !promptRunner.name) return;
                    try {
                      const result = await getPrompt({
                        serverId: promptRunner.serverId,
                        name: promptRunner.name,
                        args: promptRunner.values,
                      });
                      setPromptRunner((prev) => ({ ...prev, result }));
                    } catch (err) {
                      setPromptRunner((prev) => ({
                        ...prev,
                        error:
                          err instanceof Error ? err.message : String(err),
                      }));
                    }
                  }}
                  disabled={isGettingPrompt}
                >
                  {isGettingPrompt ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Running…
                    </>
                  ) : (
                    "Run Prompt"
                  )}
                </Button>
              )}
            <Button
              variant="outline"
              onClick={() => setPromptRunner({ open: false, values: {} })}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const StatusBadge: React.FC<{ status: McpServerStatusInfo }> = ({ status }) => {
  if (status.status === "connected") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-green-500/40 text-green-600"
      >
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </Badge>
    );
  }
  if (status.status === "connecting") {
    return (
      <Badge variant="outline" className="gap-1 border-blue-500/40 text-blue-600">
        <Loader2 className="h-3 w-3 animate-spin" />
        Connecting
      </Badge>
    );
  }
  if (status.status === "error") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-red-500/40 text-red-600"
        title={status.error}
      >
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <PowerOff className="h-3 w-3" />
      Disconnected
    </Badge>
  );
};

// ---------------------------------------------------------------------------
// Installed Server Card (My Servers tab)
// ---------------------------------------------------------------------------
interface InstalledServerCardProps {
  server: McpServer;
  tools: McpTool[];
  consentsMap: Record<string, string>;
  status: McpServerStatusInfo;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onSetConsent: (toolName: string, consent: "ask" | "always" | "denied") => void;
  onUpdateEnv: (envJson: Record<string, string>) => Promise<void>;
  isUpdating: boolean;
  isDeleting: boolean;
}

const InstalledServerCard: React.FC<InstalledServerCardProps> = ({
  server,
  tools,
  consentsMap,
  status,
  onConnect,
  onDisconnect,
  onReconnect,
  onToggleEnabled,
  onDelete,
  onSetConsent,
  onUpdateEnv,
  isUpdating,
  isDeleting,
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isEnvOpen, setIsEnvOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Inline env var editor state
  const envPairs = useMemo(() => {
    if (!server.envJson) return [];
    return Object.entries(server.envJson).map(([key, value]) => ({ key, value: String(value ?? "") }));
  }, [server.envJson]);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");

  const handleAddEnv = async () => {
    if (!newEnvKey.trim()) return;
    const updated = { ...(server.envJson || {}), [newEnvKey.trim()]: newEnvVal };
    await onUpdateEnv(updated);
    setNewEnvKey("");
    setNewEnvVal("");
  };

  const handleRemoveEnv = async (key: string) => {
    const updated = { ...(server.envJson || {}) };
    delete updated[key];
    await onUpdateEnv(updated);
  };

  return (
    <Card className={`transition-all ${!server.enabled ? "opacity-60" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                server.enabled ? "bg-primary/10" : "bg-muted"
              }`}
            >
              {server.transport === "http" ? (
                <Globe className="h-5 w-5" />
              ) : (
                <Terminal className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{server.name}</CardTitle>
                <Badge variant={server.enabled ? "default" : "secondary"} className="text-xs">
                  {server.enabled ? "Active" : "Disabled"}
                </Badge>
                <StatusBadge status={status} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                  {server.transport}
                </Badge>
                {server.command && <span className="font-mono truncate max-w-[300px]">{server.command} {server.args?.join(" ") ?? ""}</span>}
                {server.url && <span className="font-mono truncate max-w-[300px]">{server.url}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.status === "connected" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReconnect}
                  title="Reconnect"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDisconnect}
                  title="Disconnect"
                >
                  <PowerOff className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onConnect}
                disabled={status.status === "connecting"}
                title="Connect"
              >
                {status.status === "connecting" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            <Switch checked={!!server.enabled} onCheckedChange={onToggleEnabled} />
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* Tools section */}
        <Collapsible open={isToolsOpen} onOpenChange={setIsToolsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Tools
                <Badge variant="secondary" className="text-xs">{tools.length}</Badge>
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${isToolsOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-2">
            {tools.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {server.enabled ? "No tools discovered — server may still be starting" : "Enable server to discover tools"}
              </div>
            ) : (
              <div className="space-y-1.5 mt-2">
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm truncate">{tool.name}</div>
                      {tool.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[400px]">{tool.description}</div>
                      )}
                    </div>
                    <Select
                      value={consentsMap[`${server.id}:${tool.name}`] || "ask"}
                      onValueChange={(v) => onSetConsent(tool.name, v as "ask" | "always" | "denied")}
                    >
                      <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ask">Ask each time</SelectItem>
                        <SelectItem value="always">Always allow</SelectItem>
                        <SelectItem value="denied">Deny</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Environment variables (stdio only) */}
        {server.transport === "stdio" && (
          <Collapsible open={isEnvOpen} onOpenChange={setIsEnvOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Environment Variables
                  <Badge variant="secondary" className="text-xs">{envPairs.length}</Badge>
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isEnvOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-2">
              <div className="space-y-2 mt-2">
                {envPairs.map((pair) => (
                  <div key={pair.key} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                    <span className="font-mono text-xs font-medium truncate">{pair.key}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="font-mono text-xs text-muted-foreground truncate flex-1">
                      {pair.key.toLowerCase().includes("key") || pair.key.toLowerCase().includes("secret") || pair.key.toLowerCase().includes("token")
                        ? "••••••••"
                        : pair.value}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveEnv(pair.key)}
                      disabled={isUpdating}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {/* Add new */}
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                    className="h-8 font-mono text-xs flex-1"
                    disabled={isUpdating}
                  />
                  <Input
                    placeholder="value"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                    className="h-8 font-mono text-xs flex-1"
                    disabled={isUpdating}
                  />
                  <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={handleAddEnv} disabled={isUpdating || !newEnvKey.trim()}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Registry Server Card (Browse tab)
// ---------------------------------------------------------------------------
interface RegistryServerCardProps {
  server: McpServerRegistryEntry;
  isInstalled: boolean;
  onInstall: () => void;
  featured?: boolean;
}

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({
  server,
  isInstalled,
  onInstall,
  featured,
}) => {
  return (
    <Card
      className={`relative overflow-hidden transition-all hover:shadow-md ${
        featured ? "border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-transparent" : ""
      }`}
    >
      {featured && (
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="gap-1 bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
            <Star className="h-3 w-3 fill-current" />
            Featured
          </Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {server.name}
          {isInstalled && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        </CardTitle>
        <CardDescription className="line-clamp-2">{server.description}</CardDescription>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] gap-1 font-mono">
            {server.config.type === "stdio" ? <Terminal className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            {server.config.type}
          </Badge>
          {server.tags?.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
          {server.requiresAuth && (
            <Badge variant="outline" className="text-xs gap-1">
              <Shield className="h-3 w-3" />
              Auth
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="pt-2 gap-2">
        {isInstalled ? (
          <Button variant="secondary" className="flex-1" disabled>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Installed
          </Button>
        ) : (
          <Button onClick={onInstall} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            Add to Create
          </Button>
        )}
        <div className="flex gap-1">
          {server.website && (
            <Button variant="ghost" size="icon" asChild className="h-9 w-9">
              <a href={server.website} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          {server.github && (
            <Button variant="ghost" size="icon" asChild className="h-9 w-9">
              <a href={server.github} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default McpHubPage;
