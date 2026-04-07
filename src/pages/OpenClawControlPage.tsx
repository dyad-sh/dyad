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
  Maximize2,
  Minimize2,
  Brain,
} from "lucide-react";

const integrationClient = OpenClawIntegrationClient.getInstance();

// =============================================================================
// MAIN PAGE
// =============================================================================

export function OpenClawControlPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("portal");
  const [isPortalFullscreen, setIsPortalFullscreen] = useState(false);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: gatewayToken = "" } = useQuery({
    queryKey: ["openclaw-gateway-token"],
    queryFn: () => openclawClient.getGatewayToken(),
    staleTime: Infinity,
  });

  const portalUrl = gatewayToken
    ? `http://127.0.0.1:18790/?token=${encodeURIComponent(gatewayToken)}`
    : "http://127.0.0.1:18790";

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

  const isConnected = gatewayStatus?.status === "connected";
  const isLoading =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

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
                ? "Connected"
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
        </TabsList>

        {/* ================================================================= */}
        {/* PORTAL TAB — iframe to real OpenClaw Control                       */}
        {/* ================================================================= */}
        <TabsContent
          value="portal"
          className={`flex-1 m-0 ${isPortalFullscreen ? "fixed inset-0 z-50 bg-background" : ""}`}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-1 border-b">
              <span className="text-xs text-muted-foreground">
                http://127.0.0.1:18790
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setIsPortalFullscreen((f) => !f)}
              >
                {isPortalFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {isConnected ? (
              <iframe
                src={portalUrl}
                className="flex-1 w-full border-0"
                title="OpenClaw Portal"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Card className="max-w-sm text-center">
                  <CardHeader>
                    <AlertTriangle className="h-10 w-10 mx-auto text-orange-500 mb-2" />
                    <CardTitle>Gateway Offline</CardTitle>
                    <CardDescription>
                      Start the OpenClaw gateway to access the portal.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => startMutation.mutate()}
                      disabled={isLoading}
                      className="bg-gradient-to-r from-rose-500 to-orange-500 text-white"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Start Gateway
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
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
      </Tabs>
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
                value={gateway?.port ?? 18790}
                readOnly
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Gateway Enabled</Label>
            <Switch checked={gateway?.enabled ?? true} disabled />
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
              Port 18790
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


