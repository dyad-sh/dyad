/**
 * OpenClaw Control Page
 * Unified vine-and-branch hub: OpenClaw Portal, CNS, Chat, Providers, Settings
 * 🦞
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OpenClawClient as openclawClient } from "@/ipc/openclaw_client";
import { OpenClawIntegrationClient } from "@/ipc/openclaw_integration_client";
import { useCNSStatus, useCNSChat, useOllama } from "@/hooks/useOpenClawCNS";
import { CNSDashboard } from "@/components/openclaw/CNSDashboard";
import { useActivityLog, useActivityStats, useChannelMessages } from "@/hooks/useOpenClawActivity";
import {
  useAutonomousStatus,
  useAutonomousExecutions,
  useAutonomousExecution,
  useAutonomousActions,
  useAutonomousExecute,
  useAutonomousPlan,
  useAutonomousApprove,
  useAutonomousCancel,
} from "@/hooks/useOpenClawAutonomous";
import {
  useCostSummary,
  useCostBudget,
  useSetCostBudget,
  useCostRecords,
  useTaskRouting,
  useSetTaskRouting,
  useResetTaskRouting,
} from "@/hooks/useOpenClawCost";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Send,
  Settings,
  Cpu,
  Activity,
  Globe,
  Shield,
  Plug,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  Brain,
  Maximize2,
  Minimize2,
  Zap,
  ChevronDown,
  ChevronRight,
  Clock,
  ListChecks,
  DollarSign,
  TrendingDown,
  Wallet,
  RotateCcw,
} from "lucide-react";

const integrationClient = OpenClawIntegrationClient.getInstance();

// =============================================================================
// MAIN PAGE
// =============================================================================

export function OpenClawControlPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("portal");
  const [portalView, setPortalView] = useState<"dashboard" | "iframe">("iframe");
  const [portalKey, setPortalKey] = useState(0);
  const [portalLoadError, setPortalLoadError] = useState(false);
  const [isPortalFullscreen, setIsPortalFullscreen] = useState(false);

  // ---------------------------------------------------------------------------
  // Real-time event subscription — daemon events invalidate queries instantly
  // ---------------------------------------------------------------------------
  useEffect(() => {
    openclawClient.subscribe().catch(() => {});

    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["openclaw-gateway-status"] });
      queryClient.invalidateQueries({ queryKey: ["openclaw-activity"] });
      queryClient.invalidateQueries({ queryKey: ["openclaw-activity-stats"] });
      queryClient.invalidateQueries({ queryKey: ["openclaw-channel-messages"] });
    };

    openclawClient.addEventListener("message:received", handler);
    openclawClient.addEventListener("message:sent", handler);
    openclawClient.addEventListener("agent:task:started", handler);
    openclawClient.addEventListener("agent:task:completed", handler);
    openclawClient.addEventListener("gateway:connected", handler);
    openclawClient.addEventListener("gateway:disconnected", handler);

    return () => {
      openclawClient.removeEventListener("message:received", handler);
      openclawClient.removeEventListener("message:sent", handler);
      openclawClient.removeEventListener("agent:task:started", handler);
      openclawClient.removeEventListener("agent:task:completed", handler);
      openclawClient.removeEventListener("gateway:connected", handler);
      openclawClient.removeEventListener("gateway:disconnected", handler);
    };
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: gatewayToken = "" } = useQuery({
    queryKey: ["openclaw-gateway-token"],
    queryFn: () => openclawClient.getGatewayToken(),
    staleTime: Infinity,
  });

  const { data: gatewayStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["openclaw-gateway-status"],
    queryFn: () => openclawClient.getGatewayStatus(),
    refetchInterval: 5000,
  });

  const { data: providers } = useQuery({
    queryKey: ["openclaw-providers"],
    queryFn: () => openclawClient.listProviders(),
    refetchInterval: 10000,
  });

  const { data: config } = useQuery({
    queryKey: ["openclaw-config"],
    queryFn: () => openclawClient.getConfig(),
  });

  // Determine which port serves the portal:
  // • Daemon port (18790) when bridged — full control-ui with daemon WS protocol
  // • Internal gateway port (18792) as fallback for static UI
  const daemonPort = (config as unknown as Record<string, unknown> & { gateway?: { daemonPort?: number } })?.gateway?.daemonPort ?? 18790;
  const internalPort = (config as unknown as Record<string, unknown> & { gateway?: { port?: number } })?.gateway?.port ?? 18792;

  const { data: channels } = useQuery({
    queryKey: ["openclaw-channels"],
    queryFn: () => integrationClient.getChannels(),
  });

  const { data: plugins } = useQuery({
    queryKey: ["openclaw-plugins"],
    queryFn: () => integrationClient.listPlugins(),
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const startMutation = useMutation({
    mutationFn: () => openclawClient.startGateway(),
    onSuccess: () => {
      toast.success("OpenClaw gateway started");
      queryClient.invalidateQueries({ queryKey: ["openclaw-gateway-status"] });
    },
    onError: (err) => toast.error(`Failed to start: ${err}`),
  });

  const stopMutation = useMutation({
    mutationFn: () => openclawClient.stopGateway(),
    onSuccess: () => {
      toast.success("OpenClaw gateway stopped");
      queryClient.invalidateQueries({ queryKey: ["openclaw-gateway-status"] });
    },
    onError: (err) => toast.error(`Failed to stop: ${err}`),
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      await integrationClient.restartGateway();
    },
    onSuccess: () => {
      toast.success("OpenClaw gateway restarted");
      queryClient.invalidateQueries({ queryKey: ["openclaw-gateway-status"] });
    },
    onError: (err) => toast.error(`Failed to restart: ${err}`),
  });

  const yieldToDaemonMutation = useMutation({
    mutationFn: async () => integrationClient.yieldToDaemon(),
    onSuccess: (result) => {
      if (result.bridged) {
        toast.success("Connected to external OpenClaw daemon (bridge mode)");
      } else {
        toast.warning("Daemon didn't start in time — using internal gateway");
      }
      queryClient.invalidateQueries({ queryKey: ["openclaw-gateway-status"] });
    },
    onError: (err) => toast.error(`Failed to bridge: ${err}`),
  });

  const isBridged = gatewayStatus?.bridged === true;
  const isConnected = gatewayStatus?.status === "connected";
  const isLoading =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending ||
    yieldToDaemonMutation.isPending;

  // Portal URL: use daemon port when bridged (full protocol), internal port as fallback.
  // We rely on gatewayStatus.bridged (from IPC) rather than a renderer-side fetch
  // because cross-origin requests from the renderer to 127.0.0.1:18790 are
  // blocked by CORS in the daemon.
  const portalPort = isBridged ? daemonPort : internalPort;
  const portalUrl = gatewayToken
    ? `http://127.0.0.1:${portalPort}/?token=${encodeURIComponent(gatewayToken)}`
    : `http://127.0.0.1:${portalPort}`;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-rose-500/10 via-orange-500/10 to-amber-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 text-white">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
              OpenClaw Control
            </h1>
            <p className="text-xs text-muted-foreground">
              AI Gateway &bull; CNS &bull; Channels &bull; Vine &amp; Branch 🦞
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          <Badge
            variant={isConnected ? "default" : "destructive"}
            className="gap-1"
          >
            {isConnected ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {isStatusLoading
              ? "Checking…"
              : isConnected
                ? isBridged
                  ? "Bridged to Daemon"
                  : "Connected (Internal)"
                : "Disconnected"}
          </Badge>

          {/* Start / Stop / Restart */}
          {isConnected ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => restartMutation.mutate()}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1 ${restartMutation.isPending ? "animate-spin" : ""}`}
                />
                Restart
              </Button>
              {!isBridged && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => yieldToDaemonMutation.mutate()}
                  disabled={isLoading}
                  title="Stop internal gateway and connect to the external OpenClaw daemon"
                >
                  <Plug className={`h-4 w-4 mr-1 ${yieldToDaemonMutation.isPending ? "animate-spin" : ""}`} />
                  {yieldToDaemonMutation.isPending ? "Bridging…" : "Bridge to Daemon"}
                </Button>
              )}
              {isBridged && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Plug className="h-3 w-3" /> Bridged
                </Badge>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => stopMutation.mutate()}
                disabled={isLoading}
              >
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={isLoading}
              className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
            >
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          )}

          {/* External link */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(portalUrl, "_blank")}
            title="Open in browser"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="mx-4 mt-2 w-fit flex-wrap">
          <TabsTrigger value="portal" className="gap-1">
            <Globe className="h-3.5 w-3.5" />
            Portal
          </TabsTrigger>
          <TabsTrigger value="cns" className="gap-1">
            <Brain className="h-3.5 w-3.5" />
            CNS
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="providers" className="gap-1">
            <Cpu className="h-3.5 w-3.5" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="channels" className="gap-1">
            <Plug className="h-3.5 w-3.5" />
            Channels
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1">
            <Settings className="h-3.5 w-3.5" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="autonomous" className="gap-1">
            <Zap className="h-3.5 w-3.5" />
            Autonomous
          </TabsTrigger>
          <TabsTrigger value="costs" className="gap-1">
            <DollarSign className="h-3.5 w-3.5" />
            Costs
          </TabsTrigger>
        </TabsList>

        {/* ================================================================= */}
        {/* PORTAL TAB — built-in dashboard + optional iframe view             */}
        {/* ================================================================= */}
        <TabsContent
          value="portal"
          className={`flex-1 m-0 flex flex-col ${
            isPortalFullscreen ? "fixed inset-0 z-50 bg-background" : ""
          }`}
        >
          {/* Sub-view toolbar */}
          <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0">
            <div className="flex items-center gap-1 rounded-md border p-0.5 bg-muted/40">
              <Button
                size="sm"
                variant={portalView === "dashboard" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setPortalView("dashboard")}
              >
                Dashboard
              </Button>
              <Button
                size="sm"
                variant={portalView === "iframe" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setPortalView("iframe");
                  setPortalLoadError(false);
                }}
              >
                Portal (iframe)
              </Button>
            </div>
            {portalView === "iframe" && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground font-mono">
                  127.0.0.1:{portalPort}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Reload"
                  onClick={() => {
                    setPortalLoadError(false);
                    setPortalKey((k) => k + 1);
                  }}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => setIsPortalFullscreen((f) => !f)}
                >
                  {isPortalFullscreen ? (
                    <Minimize2 className="h-3 w-3" />
                  ) : (
                    <Maximize2 className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Dashboard view */}
          {portalView === "dashboard" && (
            <div className="flex-1 overflow-auto p-4">
              <GatewayDashboard
                gatewayStatus={gatewayStatus}
                isStatusLoading={isStatusLoading}
                isConnected={isConnected}
                isBridged={isBridged}
                isLoading={isLoading}
                portalPort={portalPort}
                gatewayToken={gatewayToken}
                providers={providers}
                onStart={() => startMutation.mutate()}
                onStop={() => stopMutation.mutate()}
                onRestart={() => restartMutation.mutate()}
              />
            </div>
          )}

          {/* Iframe view */}
          {portalView === "iframe" && (
            <div className="flex-1 flex flex-col min-h-0">
              {isStatusLoading && !gatewayStatus ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !isConnected ? (
                <div className="flex-1 flex items-center justify-center">
                  <Card className="max-w-sm text-center">
                    <CardHeader>
                      <AlertTriangle className="h-10 w-10 mx-auto text-orange-500 mb-2" />
                      <CardTitle>Gateway Offline</CardTitle>
                      <CardDescription>
                        Start the OpenClaw gateway to load the portal.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => startMutation.mutate()}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
                      >
                        <Play className="h-4 w-4 mr-1" />Start Gateway
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              ) : portalLoadError ? (
                <div className="flex-1 flex items-center justify-center">
                  <Card className="max-w-sm text-center">
                    <CardHeader>
                      <AlertTriangle className="h-10 w-10 mx-auto text-orange-500 mb-2" />
                      <CardTitle>Portal Failed to Load</CardTitle>
                      <CardDescription>
                        The gateway is running but the control UI could not be loaded.
                        The external OpenClaw daemon's control-ui may not be installed.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button
                        onClick={() => {
                          setPortalLoadError(false);
                          setPortalKey((k) => k + 1);
                        }}
                        className="w-full"
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />Retry
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => window.open(portalUrl, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />Open in Browser
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full text-xs"
                        onClick={() => setPortalView("dashboard")}
                      >
                        Switch to built-in Dashboard
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <iframe
                  key={`portal-${portalKey}-${gatewayToken}`}
                  src={portalUrl}
                  className="flex-1 w-full border-0"
                  style={{
                    minHeight: isPortalFullscreen
                      ? "calc(100vh - 2rem)"
                      : "calc(100vh - 14rem)",
                    height: "100%",
                  }}
                  title="OpenClaw Portal"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
                  allow="clipboard-read; clipboard-write"
                  onError={() => setPortalLoadError(true)}
                />
              )}
            </div>
          )}
        </TabsContent>

        {/* ================================================================= */}
        {/* CHAT TAB — send messages like Telegram / WhatsApp                  */}
        {/* ================================================================= */}
        <TabsContent value="chat" className="flex-1 m-0 p-4">
          <ChatPanel />
        </TabsContent>

        {/* ================================================================= */}
        {/* CNS TAB — Central Nervous System dashboard                         */}
        {/* ================================================================= */}
        <TabsContent value="cns" className="flex-1 m-0 p-4 overflow-auto">
          <CNSPanel />
        </TabsContent>

        {/* ================================================================= */}
        {/* PROVIDERS TAB                                                      */}
        {/* ================================================================= */}
        <TabsContent value="providers" className="flex-1 m-0 p-4 overflow-auto">
          <ProvidersPanel providers={providers} />
        </TabsContent>

        {/* ================================================================= */}
        {/* CHANNELS TAB                                                       */}
        {/* ================================================================= */}
        <TabsContent value="channels" className="flex-1 m-0 p-4 overflow-auto">
          <ChannelsPanel channels={channels} plugins={plugins} />
        </TabsContent>

        {/* ================================================================= */}
        {/* ACTIVITY TAB — Persistent bot/agent activity log                   */}
        {/* ================================================================= */}
        <TabsContent value="activity" className="flex-1 m-0 p-4 overflow-auto">
          <ActivityPanel />
        </TabsContent>

        {/* ================================================================= */}
        {/* SETTINGS TAB                                                       */}
        {/* ================================================================= */}
        <TabsContent value="settings" className="flex-1 m-0 p-4 overflow-auto">
          <SettingsPanel config={config} />
        </TabsContent>

        {/* ================================================================= */}
        {/* AUTONOMOUS TAB — AI-driven multi-step orchestration                */}
        {/* ================================================================= */}
        <TabsContent value="autonomous" className="flex-1 m-0 p-4 overflow-auto">
          <AutonomousPanel />
        </TabsContent>

        {/* ================================================================= */}
        {/* COSTS TAB — Smart cost tracking & budget management               */}
        {/* ================================================================= */}
        <TabsContent value="costs" className="flex-1 m-0 p-4 overflow-auto">
          <CostsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// GATEWAY DASHBOARD — built-in portal, no external package needed
// =============================================================================

function GatewayDashboard({
  gatewayStatus,
  isStatusLoading,
  isConnected,
  isBridged,
  isLoading,
  portalPort,
  gatewayToken,
  providers,
  onStart,
  onStop,
  onRestart,
}: {
  gatewayStatus: any;
  isStatusLoading: boolean;
  isConnected: boolean;
  isBridged: boolean;
  isLoading: boolean;
  portalPort: number;
  gatewayToken: string;
  providers: any;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const providerList: Array<{ name: string; type: string; available: boolean }> =
    Array.isArray(providers) ? providers : [];
  const connectedProviders = providerList.filter((p) => p.available).length;
  const apiUrl = `http://127.0.0.1:${portalPort}/api/status`;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Status card */}
      <Card className={`border-2 ${isConnected ? "border-emerald-500/40" : "border-destructive/40"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
              {isStatusLoading ? "Checking…" : isConnected ? (isBridged ? "Bridged to External Daemon" : "Internal Gateway Running") : "Gateway Offline"}
            </CardTitle>
            <div className="flex gap-2">
              {isConnected ? (
                <>
                  <Button size="sm" variant="outline" onClick={onRestart} disabled={isLoading}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />Restart
                  </Button>
                  <Button size="sm" variant="destructive" onClick={onStop} disabled={isLoading}>
                    <Square className="h-3.5 w-3.5 mr-1" />Stop
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={onStart}
                  disabled={isLoading}
                  className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
                >
                  <Play className="h-3.5 w-3.5 mr-1" />Start Gateway
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        {isConnected && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Port</p>
                <p className="font-mono font-medium">{portalPort}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Mode</p>
                <p className="font-medium">{isBridged ? "Bridge" : "Internal"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Providers</p>
                <p className="font-medium">{connectedProviders} / {providerList.length || "—"} online</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Token</p>
                <p className="font-mono font-medium truncate">{gatewayToken ? gatewayToken.slice(0, 8) + "…" : "none"}</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-rose-500" />Chat with AI
            </CardTitle>
            <CardDescription className="text-xs">
              Send messages through OpenClaw to any AI provider
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Use the <strong>Chat</strong> tab to talk to local Ollama models or cloud providers directly.
            </p>
            <Badge variant="secondary" className="text-xs">Use Chat tab →</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-500" />AI Providers
            </CardTitle>
            <CardDescription className="text-xs">
              Connect Ollama, Anthropic, OpenAI and more
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Configure which AI models power OpenClaw's responses and agents.
            </p>
            <Badge variant="secondary" className="text-xs">Use Providers tab →</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plug className="h-4 w-4 text-purple-500" />Channels
            </CardTitle>
            <CardDescription className="text-xs">
              WhatsApp, Telegram, Discord, Slack and more
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Connect messaging platforms so OpenClaw can relay AI responses.
            </p>
            <Badge variant="secondary" className="text-xs">Use Channels tab →</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-amber-500" />Autonomous
            </CardTitle>
            <CardDescription className="text-xs">
              Multi-step AI task execution across JoyCreate
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Let OpenClaw plan and execute complex tasks autonomously.
            </p>
            <Badge variant="secondary" className="text-xs">Use Autonomous tab →</Badge>
          </CardContent>
        </Card>
      </div>

      {/* API info */}
      {isConnected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-500" />Local API
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">
                {apiUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => window.open(apiUrl, "_blank")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
            {gatewayToken && (
              <p className="text-xs text-muted-foreground">
                Auth header: <code className="bg-muted px-1 rounded">X-Auth-Token: {gatewayToken}</code>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isConnected && !isStatusLoading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-orange-500 mb-3" />
            <p className="font-medium mb-1">Gateway is not running</p>
            <p className="text-sm text-muted-foreground mb-4">
              Click <strong>Start Gateway</strong> above to launch the local OpenClaw server.
              It will start automatically the next time JoyCreate opens.
            </p>
            <Button
              onClick={onStart}
              disabled={isLoading}
              className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
            >
              <Play className="h-4 w-4 mr-1" />Start Gateway
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// CHAT PANEL — communicate with OpenClaw like Telegram/WhatsApp
// =============================================================================

function ChatPanel() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string; timestamp: number }>
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = message.trim();
    if (!text || isStreaming) return;

    const userMsg = { role: "user" as const, content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setMessage("");
    setIsStreaming(true);

    try {
      const response = await openclawClient.simpleChat(text);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response, timestamp: Date.now() },
      ]);
    } catch (err: any) {
      toast.error(`OpenClaw: ${err.message ?? err}`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Error: ${err.message ?? "Failed to get response"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }, [message, isStreaming]);

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-200px)]">
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat with OpenClaw
          </CardTitle>
          <CardDescription>
            Send messages just like Telegram, WhatsApp, or any other channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0 gap-2">
          {/* Messages */}
          <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
            <div className="space-y-3 pb-2">
              {messages.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-12">
                  Send a message to start chatting with OpenClaw.
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-gradient-to-r from-rose-500 to-orange-500 text-white"
                        : "bg-muted"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isStreaming && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-3 py-2 text-sm flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking…
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Type a message…"
              disabled={isStreaming}
              className="flex-1"
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!message.trim() || isStreaming}
              className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// PROVIDERS PANEL
// =============================================================================

function ProvidersPanel({ providers }: { providers?: any[] }) {
  const queryClient = useQueryClient();
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: ["openclaw-provider-health"],
    queryFn: () => openclawClient.checkProviderHealth(),
    refetchInterval: 15000,
  });

  const handleSaveApiKey = async (providerKey: string) => {
    const key = apiKeyInputs[providerKey]?.trim();
    if (!key) return;
    setSavingKey(providerKey);
    try {
      await openclawClient.setProviderApiKey(providerKey, key);
      toast.success(`API key saved for ${providerKey}`);
      setApiKeyInputs((prev) => ({ ...prev, [providerKey]: "" }));
      queryClient.invalidateQueries({ queryKey: ["openclaw-providers"] });
      queryClient.invalidateQueries({ queryKey: ["openclaw-provider-health"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to save API key");
    } finally {
      setSavingKey(null);
    }
  };

  const handleToggleProvider = async (providerKey: string, enabled: boolean) => {
    try {
      await openclawClient.configureProvider({ name: providerKey, config: { enabled } });
      queryClient.invalidateQueries({ queryKey: ["openclaw-providers"] });
      queryClient.invalidateQueries({ queryKey: ["openclaw-provider-health"] });
      toast.success(`${providerKey} ${enabled ? "enabled" : "disabled"}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to update provider");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Providers</h2>
          <p className="text-sm text-muted-foreground">
            Local-first routing: Ollama handles simple tasks, Claude API handles complex/agentic tasks.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            healthQuery.refetch();
            queryClient.invalidateQueries({ queryKey: ["openclaw-providers"] });
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(providers ?? []).map((p: any) => {
          const healthy = healthQuery.data?.[p.name];
          const providerKey = p.name;
          const needsApiKey = ["anthropic", "openai", "deepseek", "google", "openai-compat", "claude-code"].includes(p.type);
          return (
            <Card key={p.name}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{p.name}</CardTitle>
                  <Badge
                    variant={
                      healthy === true
                        ? "default"
                        : healthy === false
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-xs"
                  >
                    {healthy === true
                      ? "Healthy"
                      : healthy === false
                        ? "Unhealthy"
                        : "Unknown"}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {p.type} &bull; {p.model}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Priority</span>
                  <span>{p.priority}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Enabled</span>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(checked) => handleToggleProvider(providerKey, checked)}
                    className="scale-75"
                  />
                </div>
                {needsApiKey && (
                  <div className="space-y-1 pt-1 border-t">
                    <Label className="text-[10px] text-muted-foreground">API Key</Label>
                    <div className="flex gap-1">
                      <Input
                        type="password"
                        placeholder={p.hasApiKey ? "••••••••  (key set)" : "Enter API key..."}
                        value={apiKeyInputs[providerKey] ?? ""}
                        onChange={(e) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [providerKey]: e.target.value,
                          }))
                        }
                        className="h-7 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!apiKeyInputs[providerKey]?.trim() || savingKey === providerKey}
                        onClick={() => handleSaveApiKey(providerKey)}
                      >
                        {savingKey === providerKey ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
                {p.capabilities && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {p.capabilities.map((c: string) => (
                      <Badge key={c} variant="outline" className="text-[10px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {(!providers || providers.length === 0) && (
          <p className="text-sm text-muted-foreground col-span-full text-center py-8">
            No providers configured yet. Check Settings tab.
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CHANNELS PANEL
// =============================================================================

function ChannelsPanel({
  channels,
  plugins,
}: {
  channels?: any[];
  plugins?: any[];
}) {
  return (
    <div className="space-y-6">
      {/* Channels */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Connected Channels</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Channels OpenClaw can send/receive messages through — Telegram,
          WhatsApp, Create chat, and more.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(Array.isArray(channels) ? channels : []).map((ch: any, i: number) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm capitalize">
                    {ch.channel ?? ch.name ?? `Channel ${i + 1}`}
                  </CardTitle>
                  <Badge
                    variant={ch.connected ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {ch.connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {ch.lastMessage
                  ? `Last message: ${new Date(ch.lastMessage).toLocaleString()}`
                  : "No messages yet"}
              </CardContent>
            </Card>
          ))}
          {(!Array.isArray(channels) || channels.length === 0) && (
            <p className="text-sm text-muted-foreground col-span-full text-center py-8">
              No channels connected. Configure channels in the OpenClaw portal.
            </p>
          )}
        </div>
      </div>

      <Separator />

      {/* Plugins */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Plugins</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Extend OpenClaw with community plugins.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(Array.isArray(plugins) ? plugins : []).map((p: any, i: number) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{p.name ?? p.id}</CardTitle>
                <CardDescription className="text-xs">
                  {p.description ?? "No description"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Badge
                  variant={p.enabled ? "default" : "secondary"}
                  className="text-xs"
                >
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </CardContent>
            </Card>
          ))}
          {(!Array.isArray(plugins) || plugins.length === 0) && (
            <p className="text-sm text-muted-foreground col-span-full text-center py-8">
              No plugins installed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// =============================================================================
// ACTIVITY PANEL — Persistent activity log & channel messages
// =============================================================================

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  message_received: { label: "Message In", color: "bg-blue-500" },
  message_sent: { label: "Message Out", color: "bg-green-500" },
  agent_started: { label: "Agent Started", color: "bg-purple-500" },
  agent_completed: { label: "Agent Done", color: "bg-emerald-500" },
  agent_failed: { label: "Agent Failed", color: "bg-red-500" },
  provider_switched: { label: "Provider", color: "bg-amber-500" },
  workflow_triggered: { label: "Workflow", color: "bg-indigo-500" },
  tool_invoked: { label: "Tool", color: "bg-cyan-500" },
  gateway_connected: { label: "Connected", color: "bg-green-600" },
  gateway_disconnected: { label: "Disconnected", color: "bg-gray-500" },
  chat_request: { label: "Chat Req", color: "bg-blue-400" },
  chat_response: { label: "Chat Resp", color: "bg-blue-600" },
  system: { label: "System", color: "bg-gray-400" },
};

const CHANNEL_ICONS: Record<string, string> = {
  discord: "🎮",
  telegram: "✈️",
  slack: "💬",
  whatsapp: "📱",
  webchat: "🌐",
};

function ActivityPanel() {
  const [activeView, setActiveView] = useState<"feed" | "messages">("feed");
  const [channelFilter, setChannelFilter] = useState<string | undefined>();

  const { data: activities = [], isLoading: feedLoading } = useActivityLog({
    limit: 200,
    channel: channelFilter as any,
  });

  const { data: stats } = useActivityStats();

  const { data: messages = [], isLoading: messagesLoading } = useChannelMessages({
    limit: 200,
    channel: channelFilter as any,
  });

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Events</p>
            <p className="text-2xl font-bold">{stats?.totalEvents ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Channel Messages</p>
            <p className="text-2xl font-bold">{stats?.totalMessages ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Tokens Used</p>
            <p className="text-2xl font-bold">{(stats?.totalTokens ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        {Object.entries(stats?.byChannel ?? {}).map(([ch, cnt]) => (
          <Card key={ch}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">{CHANNEL_ICONS[ch] || "📡"} {ch}</p>
              <p className="text-2xl font-bold">{cnt as number}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View toggle + channel filter */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={activeView === "feed" ? "default" : "outline"}
          onClick={() => setActiveView("feed")}
        >
          <Activity className="h-3.5 w-3.5 mr-1" />
          Activity Feed
        </Button>
        <Button
          size="sm"
          variant={activeView === "messages" ? "default" : "outline"}
          onClick={() => setActiveView("messages")}
        >
          <MessageSquare className="h-3.5 w-3.5 mr-1" />
          Channel Messages
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button
          size="sm"
          variant={!channelFilter ? "default" : "outline"}
          onClick={() => setChannelFilter(undefined)}
        >
          All
        </Button>
        {["discord", "telegram", "slack", "whatsapp"].map((ch) => (
          <Button
            key={ch}
            size="sm"
            variant={channelFilter === ch ? "default" : "outline"}
            onClick={() => setChannelFilter(ch)}
          >
            {CHANNEL_ICONS[ch]} {ch}
          </Button>
        ))}
      </div>

      {/* Feed */}
      {activeView === "feed" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Activity Feed</CardTitle>
            <CardDescription>
              All bot and agent activity — persisted even while JoyCreate is closed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {feedLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : activities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No activity recorded yet. Events will appear here as the bot operates.
                </p>
              ) : (
                <div className="space-y-1">
                  {activities.map((a: any) => {
                    const meta = EVENT_TYPE_LABELS[a.eventType] ?? { label: a.eventType, color: "bg-gray-400" };
                    return (
                      <div key={a.id} className="flex items-start gap-2 py-1.5 px-1 rounded hover:bg-muted/50 text-sm">
                        <Badge variant="outline" className={`${meta.color} text-white text-[10px] px-1.5 py-0 shrink-0`}>
                          {meta.label}
                        </Badge>
                        {a.channel && (
                          <span className="text-xs shrink-0">{CHANNEL_ICONS[a.channel] || "📡"}</span>
                        )}
                        <span className="text-muted-foreground text-xs shrink-0">
                          {a.actorDisplayName || a.actor}
                        </span>
                        <span className="flex-1 truncate">
                          {a.content || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date((a.createdAt?.seconds ?? a.createdAt) * 1000).toLocaleTimeString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Channel Messages */}
      {activeView === "messages" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Channel Messages</CardTitle>
            <CardDescription>
              Discord, Telegram, and other channel conversations with the bot
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No channel messages yet. Send a message to your bot on Discord or Telegram!
                </p>
              ) : (
                <div className="space-y-2">
                  {messages.map((m: any) => (
                    <div
                      key={m.id}
                      className={`flex gap-3 py-2 px-3 rounded-lg ${
                        m.isBot ? "bg-primary/5 border border-primary/20" : "bg-muted/30"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <span className="text-lg">{CHANNEL_ICONS[m.channel] || "📡"}</span>
                        {m.isBot && <Badge variant="secondary" className="text-[9px] px-1">BOT</Badge>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{m.senderName}</span>
                          {m.channelName && (
                            <span className="text-xs text-muted-foreground">in {m.channelName}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date((m.createdAt?.seconds ?? m.createdAt) * 1000).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm mt-0.5">{m.content}</p>
                        {m.provider && (
                          <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                            <span>via {m.provider}</span>
                            {m.model && <span>· {m.model}</span>}
                            {m.tokensUsed && <span>· {m.tokensUsed} tokens</span>}
                            {m.durationMs && <span>· {m.durationMs}ms</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// SETTINGS PANEL
// =============================================================================

function SettingsPanel({ config }: { config?: any }) {
  const queryClient = useQueryClient();

  const { data: autostartStatus } = useQuery({
    queryKey: ["openclaw-daemon-autostart"],
    queryFn: () => openclawClient.getDaemonAutostartStatus(),
    staleTime: 30_000,
  });

  const autostartMutation = useMutation({
    mutationFn: (enable: boolean) => openclawClient.setDaemonAutostart(enable),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["openclaw-daemon-autostart"] });
      toast.success(result.enabled ? "OpenClaw will start on boot" : "Auto-start disabled");
    },
    onError: (err) => toast.error(`Failed to update auto-start: ${err}`),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, any>) =>
      openclawClient.updateConfig(updates),
    onSuccess: () => {
      toast.success("Configuration saved");
      queryClient.invalidateQueries({ queryKey: ["openclaw-config"] });
    },
    onError: (err) => toast.error(`Save failed: ${err}`),
  });

  const gateway = config?.gateway;
  const routing = config?.routing;
  const security = config?.security;

  return (
    <div className="space-y-4">
      {/* Gateway */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Gateway
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Host</Label>
              <Input
                value={gateway?.host ?? "127.0.0.1"}
                readOnly
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Port</Label>
              <Input
                value={gateway?.port ?? 18792}
                readOnly
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Gateway Enabled</Label>
            <Switch checked={gateway?.enabled ?? true} disabled />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Start on Boot</Label>
              <p className="text-[10px] text-muted-foreground">
                Launch OpenClaw daemon automatically when Windows starts
              </p>
            </div>
            <Switch
              checked={autostartStatus?.enabled ?? false}
              disabled={autostartMutation.isPending}
              onCheckedChange={(checked) => autostartMutation.mutate(checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Routing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Routing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Default Provider</Label>
            <Badge variant="secondary" className="text-xs">
              {config?.defaultProvider ?? "ollama"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Fallback Provider</Label>
            <Badge variant="outline" className="text-xs">
              {config?.fallbackProvider ?? "none"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Smart Routing</Label>
            <Switch checked={routing?.smartRouting ?? false} disabled />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Prefer Local</Label>
            <Switch checked={routing?.preferLocal ?? true} disabled />
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Allow Remote Connections</Label>
            <Switch
              checked={security?.allowRemoteConnections ?? false}
              disabled
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// CNS PANEL — Central Nervous System (Ollama + n8n unified control)
// =============================================================================

function CNSPanel() {
  const { isInitialized, ollamaAvailable, n8nConnected, initialize, shutdown, isInitializing } = useCNSStatus();
  const { models } = useOllama();

  return (
    <div className="space-y-4">
      {/* CNS Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-violet-500 text-white">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">OpenClaw CNS 🦞</h2>
            <p className="text-sm text-muted-foreground">
              Central Nervous System — Ollama + n8n Integration
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isInitialized ? "default" : "secondary"} className="gap-1">
            {isInitialized ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {isInitialized ? "Active" : "Inactive"}
          </Badge>
          {isInitialized ? (
            <Button size="sm" variant="outline" onClick={() => shutdown()}>
              <Square className="h-4 w-4 mr-1" />
              Shutdown
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => initialize(undefined)}
              disabled={isInitializing}
              className="bg-gradient-to-r from-purple-500 to-violet-500 text-white"
            >
              {isInitializing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Initialize
            </Button>
          )}
        </div>
      </div>

      {/* Sub-system status cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Ollama (Local LLMs)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={ollamaAvailable ? "default" : "destructive"} className="text-xs">
              {ollamaAvailable ? "Available" : "Offline"}
            </Badge>
            {models?.models && (
              <p className="text-xs text-muted-foreground mt-1">
                {models.models.length} model{models.models.length !== 1 ? "s" : ""} loaded
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              n8n (Automation)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={n8nConnected ? "default" : "secondary"} className="text-xs">
              {n8nConnected ? "Connected" : "Disconnected"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              Workflow automation bridge
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4" />
              Gateway
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default" className="text-xs">
              Port 18792
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              OpenClaw message routing
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Full CNS Dashboard */}
      <CNSDashboard />
    </div>
  );
}

// =============================================================================
// AUTONOMOUS PANEL — AI-driven multi-step orchestration brain
// =============================================================================

function AutonomousPanel() {
  const [input, setInput] = useState("");
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);

  const { data: status } = useAutonomousStatus();
  const { data: executions } = useAutonomousExecutions();
  const { data: selectedExec } = useAutonomousExecution(selectedExecId ?? undefined);
  const { data: actions } = useAutonomousActions();

  const executeMut = useAutonomousExecute();
  const planMut = useAutonomousPlan();
  const approveMut = useAutonomousApprove();
  const cancelMut = useAutonomousCancel();

  const handleExecute = (opts?: { requireApproval?: boolean; planOnly?: boolean }) => {
    const text = input.trim();
    if (!text) return;
    const request = { input: text, ...opts };
    if (opts?.planOnly) {
      planMut.mutate(request, {
        onSuccess: (exec) => {
          toast.success("Plan created — review steps below");
          setSelectedExecId(exec.id);
          setInput("");
        },
        onError: (err) => toast.error(`Plan failed: ${err.message}`),
      });
    } else {
      executeMut.mutate(request, {
        onSuccess: (exec) => {
          toast.success("Execution started");
          setSelectedExecId(exec.id);
          setInput("");
        },
        onError: (err) => toast.error(`Execution failed: ${err.message}`),
      });
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "completed": return "default";
      case "executing": case "planning": return "secondary";
      case "failed": return "destructive";
      case "paused": return "outline";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Autonomous Brain 🦞</h2>
            <p className="text-sm text-muted-foreground">
              AI-driven multi-step orchestration across all JoyCreate features
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Activity className="h-3 w-3" />
                {status.activeExecutions} active
              </Badge>
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {status.completedExecutions} done
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Input Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What should OpenClaw do?</CardTitle>
          <CardDescription>
            Describe a task in natural language. The AI will plan steps across apps,
            agents, workflows, email, studios, and more — then execute them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Create a landing page app, deploy it to Vercel, then email the link to my team…"
            className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) handleExecute();
            }}
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => handleExecute()}
              disabled={!input.trim() || executeMut.isPending}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            >
              {executeMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-1" />
              )}
              Execute
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExecute({ requireApproval: true })}
              disabled={!input.trim() || executeMut.isPending}
            >
              <Shield className="h-4 w-4 mr-1" />
              Execute with Approval
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExecute({ planOnly: true })}
              disabled={!input.trim() || planMut.isPending}
            >
              {planMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ListChecks className="h-4 w-4 mr-1" />
              )}
              Plan Only
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Selected Execution Detail */}
      {selectedExec && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Execution: {selectedExec.input.slice(0, 60)}
                {selectedExec.input.length > 60 ? "…" : ""}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={statusColor(selectedExec.status)}>
                  {selectedExec.status}
                </Badge>
                {selectedExec.status === "paused" && (
                  <Button
                    size="sm"
                    onClick={() => approveMut.mutate(selectedExec.id)}
                    disabled={approveMut.isPending}
                    className="bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Approve
                  </Button>
                )}
                {(selectedExec.status === "executing" || selectedExec.status === "paused") && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => cancelMut.mutate(selectedExec.id)}
                    disabled={cancelMut.isPending}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            {selectedExec.plan && (
              <CardDescription className="mt-1">
                {selectedExec.plan.reasoning}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {/* Progress */}
            {selectedExec.progress > 0 && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span>{Math.round(selectedExec.progress * 100)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
                    style={{ width: `${selectedExec.progress * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Steps */}
            {selectedExec.plan?.steps && (
              <div className="space-y-2">
                {selectedExec.plan.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`flex items-start gap-2 p-2 rounded-md text-sm ${
                      step.status === "completed"
                        ? "bg-green-500/10"
                        : step.status === "executing"
                          ? "bg-amber-500/10"
                          : step.status === "failed"
                            ? "bg-red-500/10"
                            : "bg-muted/50"
                    }`}
                  >
                    <span className="font-mono text-xs text-muted-foreground mt-0.5 w-5">
                      {idx + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{step.description}</span>
                        <Badge variant="outline" className="text-[10px] px-1">
                          {step.actionId}
                        </Badge>
                      </div>
                      {step.error && (
                        <p className="text-xs text-red-500 mt-1">{step.error}</p>
                      )}
                      {step.durationMs != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <Clock className="inline h-3 w-3 mr-0.5" />
                          {(step.durationMs / 1000).toFixed(1)}s
                        </p>
                      )}
                    </div>
                    <Badge variant={statusColor(step.status)} className="text-[10px]">
                      {step.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
                      {step.status === "executing" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {step.status === "failed" && <XCircle className="h-3 w-3" />}
                      {step.status === "pending" && <Clock className="h-3 w-3" />}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {selectedExec.error && (
              <div className="mt-3 p-2 rounded-md bg-red-500/10 text-sm text-red-500">
                <AlertTriangle className="inline h-4 w-4 mr-1" />
                {selectedExec.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Execution History */}
      {executions && executions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Executions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {executions.map((exec) => (
                <button
                  key={exec.id}
                  onClick={() => setSelectedExecId(exec.id)}
                  className={`w-full flex items-center justify-between p-2 rounded-md text-sm hover:bg-muted transition-colors text-left ${
                    selectedExecId === exec.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="truncate font-medium">{exec.input}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(exec.createdAt).toLocaleString()}
                      {exec.durationMs != null && ` · ${(exec.durationMs / 1000).toFixed(1)}s`}
                    </p>
                  </div>
                  <Badge variant={statusColor(exec.status)} className="text-[10px] shrink-0">
                    {exec.status}
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Available Actions */}
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex items-center gap-2 text-left w-full"
          >
            {showActions ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <CardTitle className="text-sm">
              Available Actions ({actions?.length ?? 0})
            </CardTitle>
          </button>
          <CardDescription>
            Actions the autonomous brain can dispatch across JoyCreate
          </CardDescription>
        </CardHeader>
        {showActions && actions && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="p-2 rounded-md border text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {action.category}
                    </Badge>
                    <span className="font-medium">{action.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {action.description}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// =============================================================================
// COSTS PANEL — Smart cost tracking & budget management
// =============================================================================

function CostsPanel() {
  const { data: summary } = useCostSummary();
  const { data: budget } = useCostBudget();
  const { data: records } = useCostRecords(20);
  const setBudgetMut = useSetCostBudget();
  const { data: taskRouting } = useTaskRouting();
  const setTaskRoutingMut = useSetTaskRouting();
  const resetTaskRoutingMut = useResetTaskRouting();

  const [dailyLimit, setDailyLimit] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [autoDowngrade, setAutoDowngrade] = useState(true);
  const [preferFree, setPreferFree] = useState(true);

  // Sync form state with loaded budget
  useEffect(() => {
    if (budget) {
      setDailyLimit(String(budget.dailyLimitUsd));
      setMonthlyLimit(String(budget.monthlyLimitUsd));
      setAutoDowngrade(budget.autoDowngrade);
      setPreferFree(budget.preferFree);
    }
  }, [budget]);

  const handleSaveBudget = () => {
    const daily = parseFloat(dailyLimit);
    const monthly = parseFloat(monthlyLimit);
    if (isNaN(daily) || isNaN(monthly) || daily <= 0 || monthly <= 0) {
      toast.error("Budget limits must be positive numbers");
      return;
    }
    setBudgetMut.mutate(
      { dailyLimitUsd: daily, monthlyLimitUsd: monthly, autoDowngrade, preferFree },
      { onSuccess: () => toast.success("Budget settings saved") },
    );
  };

  const dailyPct = summary
    ? Math.min(100, (summary.todayUsd / summary.budget.dailyLimitUsd) * 100)
    : 0;
  const monthlyPct = summary
    ? Math.min(100, (summary.monthUsd / summary.budget.monthlyLimitUsd) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Smart Costing 🦞</h2>
            <p className="text-sm text-muted-foreground">
              Track API spend, set budgets, auto-downgrade to save money
            </p>
          </div>
        </div>
        {summary && (
          <div className="flex items-center gap-2">
            {summary.overBudget && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Over Budget
              </Badge>
            )}
            {summary.warningActive && !summary.overBudget && (
              <Badge variant="secondary" className="gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Approaching Limit
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Spend Overview */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-xl font-bold">${summary.todayUsd.toFixed(4)}</p>
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${dailyPct > 80 ? "bg-red-500" : dailyPct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${dailyPct}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                of ${summary.budget.dailyLimitUsd.toFixed(2)} daily limit
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-xl font-bold">${summary.monthUsd.toFixed(4)}</p>
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${monthlyPct > 80 ? "bg-red-500" : monthlyPct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${monthlyPct}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                of ${summary.budget.monthlyLimitUsd.toFixed(2)} monthly limit
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Requests Today</p>
              <p className="text-xl font-bold">{summary.todayRequests}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {summary.todayTokens.toLocaleString()} tokens
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-emerald-500" />
                Saved by Local
              </p>
              <p className="text-xl font-bold text-emerald-600">
                ${summary.savedByLocal.toFixed(4)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                by using free Ollama models
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Budget Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Budget Settings
          </CardTitle>
          <CardDescription>
            Set spending limits. When exceeded, OpenClaw auto-downgrades to cheaper or free models.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Daily Limit (USD)</Label>
              <Input
                type="number"
                step="0.50"
                min="0"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                placeholder="5.00"
              />
            </div>
            <div>
              <Label className="text-xs">Monthly Limit (USD)</Label>
              <Input
                type="number"
                step="1"
                min="0"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                placeholder="50.00"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-downgrade when near limit</Label>
              <p className="text-xs text-muted-foreground">
                Switch to cheaper models when spending hits {summary?.budget.warningThresholdPct ?? 80}% of the daily limit
              </p>
            </div>
            <Switch checked={autoDowngrade} onCheckedChange={setAutoDowngrade} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Prefer free / local models</Label>
              <p className="text-xs text-muted-foreground">
                Route to Ollama or free OpenRouter models whenever they can handle the task
              </p>
            </div>
            <Switch checked={preferFree} onCheckedChange={setPreferFree} />
          </div>

          <Button
            size="sm"
            onClick={handleSaveBudget}
            disabled={setBudgetMut.isPending}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
          >
            {setBudgetMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1" />
            )}
            Save Budget
          </Button>
        </CardContent>
      </Card>

      {/* Task-to-Model Routing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Task → Model Routing
          </CardTitle>
          <CardDescription>
            Assign a preferred model per module. Telegram/Discord chat uses the Chat model instead of
            expensive ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {taskRouting &&
            (
              Object.entries(taskRouting) as Array<
                [string, { model: string; provider: string; reason: string }]
              >
            ).map(([module, route]) => (
              <div
                key={module}
                className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium capitalize">{module}</span>
                  <p className="text-[10px] text-muted-foreground truncate">{route.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    className="h-7 text-xs w-56"
                    value={route.model}
                    onChange={(e) => {
                      setTaskRoutingMut.mutate(
                        {
                          [module]: { ...route, model: e.target.value },
                        },
                        {
                          onSuccess: () => toast.success(`${module} model updated`),
                        },
                      );
                    }}
                    onBlur={(e) => {
                      if (!e.target.value.trim()) return;
                    }}
                  />
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {route.provider}
                  </Badge>
                </div>
              </div>
            ))}

          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                resetTaskRoutingMut.mutate(undefined, {
                  onSuccess: () => toast.success("Task routing reset to defaults"),
                })
              }
              disabled={resetTaskRoutingMut.isPending}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset to Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Top Spending Models */}
      {summary && summary.topModels.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Spending Models</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.topModels.map((m) => (
                <div
                  key={m.model}
                  className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/50"
                >
                  <div>
                    <span className="font-medium">{m.model}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {m.requests} requests
                    </span>
                  </div>
                  <span className={`font-mono ${m.cost === 0 ? "text-emerald-600" : ""}`}>
                    ${m.cost.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Cost Records */}
      {records && records.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent API Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {records.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between text-xs p-1.5 rounded border-b last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={r.totalCost === 0 ? "outline" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      {r.source}
                    </Badge>
                    <span className="truncate">{r.model}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground">
                      {r.totalTokens.toLocaleString()} tok
                    </span>
                    <span className={`font-mono ${r.totalCost === 0 ? "text-emerald-600" : ""}`}>
                      ${r.totalCost.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

