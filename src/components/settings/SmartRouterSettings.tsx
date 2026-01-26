/**
 * SmartRouterSettings - Configuration UI for intelligent model routing
 * 
 * Allows users to:
 * - Toggle local-first mode
 * - Set privacy levels
 * - Configure cost limits
 * - View and manage providers
 * - Monitor routing statistics
 */

import React, { useState } from "react";
import { useSmartRouter } from "@/hooks/useSmartRouter";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Cpu,
  Cloud,
  Shield,
  Zap,
  DollarSign,
  BarChart3,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  Activity,
  Server,
  Globe,
  Lock,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { PrivacyLevel, AIProvider } from "@/ipc/smart_router_client";

// Privacy level descriptions
const PRIVACY_DESCRIPTIONS: Record<PrivacyLevel, { label: string; description: string; icon: React.ReactNode }> = {
  public: {
    label: "Public",
    description: "Data can be sent to any provider, including cloud services",
    icon: <Globe className="h-4 w-4" />,
  },
  standard: {
    label: "Standard",
    description: "Data can go to trusted providers; metadata may be logged",
    icon: <Shield className="h-4 w-4" />,
  },
  sensitive: {
    label: "Sensitive",
    description: "Prefer local processing; cloud only if encrypted",
    icon: <Lock className="h-4 w-4" />,
  },
  private: {
    label: "Private",
    description: "Local processing only; no cloud fallback",
    icon: <Lock className="h-4 w-4 text-amber-500" />,
  },
  air_gapped: {
    label: "Air-Gapped",
    description: "Completely offline; no network access",
    icon: <WifiOff className="h-4 w-4 text-red-500" />,
  },
};

export function SmartRouterSettings() {
  const {
    providers,
    localProviders,
    cloudProviders,
    config,
    stats,
    isLoadingProviders,
    isLoadingConfig,
    isLoadingStats,
    updateConfig,
    isUpdatingConfig,
    setPreferLocal,
    setPrivacyLevel,
    setCostOptimization,
  } = useSmartRouter();

  const [activeTab, setActiveTab] = useState("overview");

  // Calculate derived stats
  const localUsagePercent = stats?.localRequests && stats?.totalRequests
    ? Math.round((stats.localRequests / stats.totalRequests) * 100)
    : 0;
  const costSavingsPercent = stats?.costSavings && stats?.totalCostCents
    ? Math.round((stats.costSavings / (stats.totalCostCents + stats.costSavings)) * 100)
    : 0;

  // Get privacy level safely
  const privacyLevel = config?.defaultPrivacyLevel as PrivacyLevel | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Smart Router</h2>
          <p className="text-muted-foreground">
            Intelligent routing between local models and cloud APIs
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config?.preferLocal ? (
            <Badge variant="secondary" className="gap-1">
              <Cpu className="h-3 w-3" /> Local-First
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Cloud className="h-3 w-3" /> Cloud-Enabled
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="routing" className="gap-2">
            <Zap className="h-4 w-4" /> Routing
          </TabsTrigger>
          <TabsTrigger value="providers" className="gap-2">
            <Server className="h-4 w-4" /> Providers
          </TabsTrigger>
          <TabsTrigger value="privacy" className="gap-2">
            <Shield className="h-4 w-4" /> Privacy
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalRequests ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.fallbackRate ? `${(stats.fallbackRate * 100).toFixed(1)}% fallback rate` : "No fallbacks yet"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Local Usage</CardTitle>
                <Cpu className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{localUsagePercent}%</div>
                <div className="mt-2 h-2 rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${localUsagePercent}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cost Savings</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  ${((stats?.costSavings ?? 0) / 100).toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  {costSavingsPercent}% saved vs cloud-only
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.avgLatencyMs ? `${Math.round(stats.avgLatencyMs)}ms` : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Average response time
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Provider Status */}
          <Card>
            <CardHeader>
              <CardTitle>Provider Status</CardTitle>
              <CardDescription>
                {localProviders.length} local, {cloudProviders.length} cloud providers available
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {providers.slice(0, 6).map((provider: AIProvider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      {provider.type === "local" ? (
                        <Cpu className="h-5 w-5 text-green-500" />
                      ) : (
                        <Cloud className="h-5 w-5 text-blue-500" />
                      )}
                      <div>
                        <p className="font-medium">{provider.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {provider.models.length} models • {provider.type}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {provider.status === "online" ? (
                        <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Online
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 bg-red-100 text-red-700">
                          <XCircle className="h-3 w-3" /> {provider.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Routing Tab */}
        <TabsContent value="routing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Routing Preferences</CardTitle>
              <CardDescription>
                Configure how requests are routed between providers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Prefer Local */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Prefer Local Models</Label>
                  <p className="text-sm text-muted-foreground">
                    Route to local models when possible for privacy and cost savings
                  </p>
                </div>
                <Switch
                  checked={config?.preferLocal ?? true}
                  onCheckedChange={(checked) => setPreferLocal(checked)}
                />
              </div>

              {/* Cost Optimization */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Cost Optimization</Label>
                  <p className="text-sm text-muted-foreground">
                    Prioritize cheaper models when quality requirements allow
                  </p>
                </div>
                <Select
                  value={config?.costOptimization ?? "balanced"}
                  onValueChange={(value) => setCostOptimization(value as "aggressive" | "balanced" | "quality")}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="quality">Quality</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Max Cost Per Request */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Max Cost Per Request</Label>
                  <span className="text-sm font-medium">
                    ${((config?.maxCostPerRequestCents ?? 10) / 100).toFixed(3)}
                  </span>
                </div>
                <Slider
                  value={[config?.maxCostPerRequestCents ?? 10]}
                  min={1}
                  max={100}
                  step={1}
                  onValueChange={([value]) =>
                    updateConfig({ maxCostPerRequestCents: value })
                  }
                  disabled={isUpdatingConfig}
                />
                <p className="text-xs text-muted-foreground">
                  Requests above this cost will prefer local models or be rejected
                </p>
              </div>

              {/* Max Latency */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Max Latency (ms)</Label>
                  <span className="text-sm font-medium">
                    {config?.maxLatencyMs ?? 30000}ms
                  </span>
                </div>
                <Slider
                  value={[config?.maxLatencyMs ?? 30000]}
                  min={1000}
                  max={60000}
                  step={1000}
                  onValueChange={([value]) =>
                    updateConfig({ maxLatencyMs: value })
                  }
                  disabled={isUpdatingConfig}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum acceptable response time before trying fallback
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Providers Tab */}
        <TabsContent value="providers" className="space-y-4">
          {/* Local Providers */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-green-500" /> Local Providers
                  </CardTitle>
                  <CardDescription>
                    On-device AI models for privacy and cost savings
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm">
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {localProviders.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Cpu className="mx-auto h-12 w-12 opacity-50" />
                  <p className="mt-2">No local providers configured</p>
                  <p className="text-sm">
                    Install Ollama or llama.cpp to enable local inference
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {localProviders.map((provider: AIProvider) => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cloud Providers */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Cloud className="h-5 w-5 text-blue-500" /> Cloud Providers
                  </CardTitle>
                  <CardDescription>
                    Remote AI APIs for complex tasks
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {cloudProviders.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Cloud className="mx-auto h-12 w-12 opacity-50" />
                  <p className="mt-2">No cloud providers configured</p>
                  <p className="text-sm">
                    Add API keys in settings to enable cloud inference
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cloudProviders.map((provider: AIProvider) => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Privacy Tab */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Privacy Level</CardTitle>
              <CardDescription>
                Control how your data is handled during AI inference
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={privacyLevel ?? "standard"}
                onValueChange={(value) => setPrivacyLevel(value as PrivacyLevel)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select privacy level" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIVACY_DESCRIPTIONS).map(([level, info]) => (
                    <SelectItem key={level} value={level}>
                      <div className="flex items-center gap-2">
                        {info.icon}
                        <span>{info.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="rounded-lg border p-4">
                {privacyLevel && PRIVACY_DESCRIPTIONS[privacyLevel] && (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {PRIVACY_DESCRIPTIONS[privacyLevel].icon}
                    </div>
                    <div>
                      <p className="font-medium">
                        {PRIVACY_DESCRIPTIONS[privacyLevel].label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {PRIVACY_DESCRIPTIONS[privacyLevel].description}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Privacy Features */}
              <div className="space-y-3 pt-4">
                <h4 className="font-medium">Privacy Features</h4>
                
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <Lock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Encrypt Before Cloud</p>
                      <p className="text-xs text-muted-foreground">
                        Encrypt sensitive prompts before sending to cloud APIs
                      </p>
                    </div>
                  </div>
                  <Switch disabled />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">PII Detection</p>
                      <p className="text-xs text-muted-foreground">
                        Automatically redact personal information
                      </p>
                    </div>
                  </div>
                  <Switch disabled />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <WifiOff className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Offline Mode</p>
                      <p className="text-xs text-muted-foreground">
                        Completely disable network for AI inference
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={privacyLevel === "air_gapped"}
                    onCheckedChange={(checked) =>
                      setPrivacyLevel(checked ? "air_gapped" : "standard")
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Provider card component
function ProviderCard({ provider }: { provider: AIProvider }) {
  const priorityColors: Record<number, string> = {
    1: "text-green-600",
    2: "text-blue-600",
    3: "text-amber-600",
    4: "text-orange-600",
    5: "text-red-600",
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {provider.type === "local" ? (
            <div className="rounded-full bg-green-100 p-2">
              <Cpu className="h-5 w-5 text-green-600" />
            </div>
          ) : provider.type === "p2p" ? (
            <div className="rounded-full bg-purple-100 p-2">
              <Wifi className="h-5 w-5 text-purple-600" />
            </div>
          ) : (
            <div className="rounded-full bg-blue-100 p-2">
              <Cloud className="h-5 w-5 text-blue-600" />
            </div>
          )}
          <div>
            <h4 className="font-medium">{provider.name}</h4>
            <p className="text-sm text-muted-foreground capitalize">
              {provider.type} provider
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              priorityColors[provider.priority] || "text-gray-600"
            )}
          >
            Priority {provider.priority}
          </Badge>
          {provider.status === "online" ? (
            <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
              <CheckCircle2 className="h-3 w-3" /> Online
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 bg-red-100 text-red-700">
              <XCircle className="h-3 w-3" /> {provider.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Models */}
      <div className="mt-3 flex flex-wrap gap-1">
        {provider.models.slice(0, 5).map((model) => (
          <Badge key={model.id} variant="secondary" className="text-xs">
            {model.name}
          </Badge>
        ))}
        {provider.models.length > 5 && (
          <Badge variant="outline" className="text-xs">
            +{provider.models.length - 5} more
          </Badge>
        )}
      </div>

      {/* Capabilities */}
      {provider.capabilities && (
        <div className="mt-3 flex flex-wrap gap-1">
          {provider.capabilities.chat && (
            <Badge variant="outline" className="text-xs">Chat</Badge>
          )}
          {provider.capabilities.completion && (
            <Badge variant="outline" className="text-xs">Completion</Badge>
          )}
          {provider.capabilities.vision && (
            <Badge variant="outline" className="text-xs">Vision</Badge>
          )}
          {provider.capabilities.tools && (
            <Badge variant="outline" className="text-xs">Tools</Badge>
          )}
          {provider.capabilities.embedding && (
            <Badge variant="outline" className="text-xs">Embedding</Badge>
          )}
        </div>
      )}

      {/* Pricing */}
      {provider.pricing && (
        <div className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">Pricing:</span>{" "}
          ${(provider.pricing.inputPer1kTokens / 100).toFixed(4)}/1K input,{" "}
          ${(provider.pricing.outputPer1kTokens / 100).toFixed(4)}/1K output
        </div>
      )}
    </div>
  );
}

export default SmartRouterSettings;
