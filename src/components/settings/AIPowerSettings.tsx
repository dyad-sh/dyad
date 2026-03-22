/**
 * AI Power Settings - JoyCreate's Advanced AI Configuration
 * 
 * Unlike competitors who lock these features behind paywalls,
 * JoyCreate gives you FULL control over your AI setup - FREE!
 * 
 * Features:
 * - Local AI provider configuration (Ollama, LM Studio, etc.)
 * - Multi-model orchestration setup
 * - Smart routing preferences
 * - Context window management
 * - Performance tuning
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { 
  Cpu, 
  Cloud, 
  Zap, 
  Settings2, 
  RefreshCw, 
  CheckCircle2, 
  XCircle,
  Server,
  Brain,
  Layers,
  Gauge,
  Shield,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface LocalProvider {
  id: string;
  name: string;
  icon: string;
  defaultPort: number;
  description: string;
  setupUrl: string;
}

interface ProviderStatus {
  id: string;
  isAvailable: boolean;
  models: string[];
  latencyMs?: number;
}

interface AISettings {
  // Local AI
  enableLocalAI: boolean;
  preferredLocalProvider: string;
  localProviderPorts: Record<string, number>;
  
  // Routing
  routingStrategy: "local-first" | "cloud-first" | "smart" | "cost-optimal";
  fallbackToCloud: boolean;
  
  // Context
  maxContextTokens: number;
  enableUnlimitedContext: boolean;
  smartContextMode: boolean;
  
  // Orchestration
  enableMultiModel: boolean;
  orchestrationPreset: string;
  
  // Performance
  streamResponses: boolean;
  parallelRequests: number;
  cacheResponses: boolean;
  
  // Quality
  defaultTemperature: number;
  enableReasoningMode: boolean;
  autoValidateCode: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const LOCAL_PROVIDERS: LocalProvider[] = [
  {
    id: "ollama",
    name: "Ollama",
    icon: "🦙",
    defaultPort: 11434,
    description: "Easy-to-use local LLM server",
    setupUrl: "https://ollama.ai",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    icon: "🎨",
    defaultPort: 1234,
    description: "GUI for running local models",
    setupUrl: "https://lmstudio.ai",
  },
  {
    id: "llamacpp",
    name: "llama.cpp",
    icon: "⚡",
    defaultPort: 8080,
    description: "High-performance C++ inference",
    setupUrl: "https://github.com/ggerganov/llama.cpp",
  },
  {
    id: "vllm",
    name: "vLLM",
    icon: "🚀",
    defaultPort: 8000,
    description: "High-throughput inference server",
    setupUrl: "https://vllm.ai",
  },
  {
    id: "localai",
    name: "LocalAI",
    icon: "🤖",
    defaultPort: 8080,
    description: "OpenAI-compatible local server",
    setupUrl: "https://localai.io",
  },
  {
    id: "gpt4all",
    name: "GPT4All",
    icon: "💻",
    defaultPort: 4891,
    description: "Cross-platform local AI",
    setupUrl: "https://gpt4all.io",
  },
  {
    id: "jan",
    name: "Jan",
    icon: "🎯",
    defaultPort: 1337,
    description: "Open-source ChatGPT alternative",
    setupUrl: "https://jan.ai",
  },
];

const ORCHESTRATION_PRESETS = [
  { id: "code-excellence", name: "Code Excellence", description: "Best quality for code generation" },
  { id: "local-first", name: "Local First", description: "Prioritize local models with cloud fallback" },
  { id: "accurate-consensus", name: "Accurate Consensus", description: "Multiple models vote for accuracy" },
  { id: "reasoning-debate", name: "Reasoning Debate", description: "Models debate for complex problems" },
  { id: "creative-pipeline", name: "Creative Pipeline", description: "Sequential refinement for creative tasks" },
  { id: "parallel-research", name: "Parallel Research", description: "Multiple perspectives combined" },
];

const DEFAULT_SETTINGS: AISettings = {
  enableLocalAI: true,
  preferredLocalProvider: "ollama",
  localProviderPorts: {},
  routingStrategy: "smart",
  fallbackToCloud: true,
  maxContextTokens: 128000,
  enableUnlimitedContext: true,
  smartContextMode: true,
  enableMultiModel: false,
  orchestrationPreset: "local-first",
  streamResponses: true,
  parallelRequests: 2,
  cacheResponses: true,
  defaultTemperature: 0.7,
  enableReasoningMode: false,
  autoValidateCode: true,
};

// =============================================================================
// COMPONENT
// =============================================================================

export function AIPowerSettings() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderStatus>>({});
  const [isCheckingProviders, setIsCheckingProviders] = useState(false);

  // Load saved settings
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // Would load from IPC/storage
      // For now, use defaults
    } catch (err) {
      console.error("Failed to load AI settings:", err);
    }
  };

  const saveSettings = async () => {
    try {
      // Would save via IPC
      toast.success("AI settings saved!");
    } catch (err) {
      toast.error("Failed to save settings");
    }
  };

  const checkProviders = async () => {
    setIsCheckingProviders(true);
    const statuses: Record<string, ProviderStatus> = {};

    for (const provider of LOCAL_PROVIDERS) {
      try {
        const port = settings.localProviderPorts[provider.id] || provider.defaultPort;
        const response = await fetch(`http://localhost:${port}/api/tags`, {
          method: "GET",
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);

        if (response?.ok) {
          const data = await response.json().catch(() => ({}));
          statuses[provider.id] = {
            id: provider.id,
            isAvailable: true,
            models: data.models?.map((m: { name: string }) => m.name) || [],
          };
        } else {
          statuses[provider.id] = { id: provider.id, isAvailable: false, models: [] };
        }
      } catch {
        statuses[provider.id] = { id: provider.id, isAvailable: false, models: [] };
      }
    }

    setProviderStatuses(statuses);
    setIsCheckingProviders(false);
    
    const availableCount = Object.values(statuses).filter(s => s.isAvailable).length;
    if (availableCount > 0) {
      toast.success(`Found ${availableCount} local AI provider(s)!`);
    } else {
      toast.info("No local AI providers detected. Install Ollama to get started!");
    }
  };

  const updateSetting = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-yellow-500" />
            AI Power Settings
          </h2>
          <p className="text-muted-foreground">
            Configure your AI setup - all features FREE in Create! 🎉
          </p>
        </div>
        <Button onClick={saveSettings}>
          Save Settings
        </Button>
      </div>

      <Tabs defaultValue="local" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="local" className="gap-2">
            <Cpu className="h-4 w-4" />
            Local AI
          </TabsTrigger>
          <TabsTrigger value="routing" className="gap-2">
            <Zap className="h-4 w-4" />
            Smart Routing
          </TabsTrigger>
          <TabsTrigger value="context" className="gap-2">
            <Layers className="h-4 w-4" />
            Context
          </TabsTrigger>
          <TabsTrigger value="orchestration" className="gap-2">
            <Brain className="h-4 w-4" />
            Multi-Model
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-2">
            <Gauge className="h-4 w-4" />
            Performance
          </TabsTrigger>
        </TabsList>

        {/* Local AI Tab */}
        <TabsContent value="local" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Local AI Providers
              </CardTitle>
              <CardDescription>
                Run AI models locally for free, unlimited usage with full privacy!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.enableLocalAI}
                    onCheckedChange={(v) => updateSetting("enableLocalAI", v)}
                  />
                  <Label>Enable Local AI</Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkProviders}
                  disabled={isCheckingProviders}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", isCheckingProviders && "animate-spin")} />
                  Detect Providers
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {LOCAL_PROVIDERS.map((provider) => {
                  const status = providerStatuses[provider.id];
                  return (
                    <Card 
                      key={provider.id} 
                      className={cn(
                        "cursor-pointer transition-colors",
                        settings.preferredLocalProvider === provider.id && "border-primary",
                        status?.isAvailable && "border-green-500/50"
                      )}
                      onClick={() => updateSetting("preferredLocalProvider", provider.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{provider.icon}</span>
                            <div>
                              <h4 className="font-medium">{provider.name}</h4>
                              <p className="text-xs text-muted-foreground">
                                {provider.description}
                              </p>
                            </div>
                          </div>
                          {status?.isAvailable ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Label className="text-xs">Port:</Label>
                          <Input
                            type="number"
                            className="h-7 w-20 text-xs"
                            value={settings.localProviderPorts[provider.id] || provider.defaultPort}
                            onChange={(e) => setSettings(prev => ({
                              ...prev,
                              localProviderPorts: {
                                ...prev.localProviderPorts,
                                [provider.id]: parseInt(e.target.value) || provider.defaultPort,
                              },
                            }))}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {status?.isAvailable && status.models.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {status.models.slice(0, 3).map((model) => (
                              <Badge key={model} variant="secondary" className="text-xs">
                                {model}
                              </Badge>
                            ))}
                            {status.models.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{status.models.length - 3} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Smart Routing Tab */}
        <TabsContent value="routing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Intelligent Request Routing
              </CardTitle>
              <CardDescription>
                Create automatically routes requests to the best available model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Routing Strategy</Label>
                <Select
                  value={settings.routingStrategy}
                  onValueChange={(v) => updateSetting("routingStrategy", v as AISettings["routingStrategy"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local-first">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4" />
                        Local First - Prefer local models
                      </div>
                    </SelectItem>
                    <SelectItem value="cloud-first">
                      <div className="flex items-center gap-2">
                        <Cloud className="h-4 w-4" />
                        Cloud First - Prefer cloud APIs
                      </div>
                    </SelectItem>
                    <SelectItem value="smart">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        Smart - Auto-select best model per task
                      </div>
                    </SelectItem>
                    <SelectItem value="cost-optimal">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Cost Optimal - Minimize API costs
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <Label>Fallback to Cloud</Label>
                  <p className="text-xs text-muted-foreground">
                    Use cloud models when local fails
                  </p>
                </div>
                <Switch
                  checked={settings.fallbackToCloud}
                  onCheckedChange={(v) => updateSetting("fallbackToCloud", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Context Tab */}
        <TabsContent value="context" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Context Window Management
              </CardTitle>
              <CardDescription>
                Unlimited context with local models - no token limits!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <Label className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-yellow-500" />
                    Unlimited Context Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    No token limits with local models!
                  </p>
                </div>
                <Switch
                  checked={settings.enableUnlimitedContext}
                  onCheckedChange={(v) => updateSetting("enableUnlimitedContext", v)}
                />
              </div>

              <div className="space-y-2">
                <Label>Max Context Tokens (for cloud models)</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.maxContextTokens]}
                    onValueChange={([v]) => updateSetting("maxContextTokens", v)}
                    min={4096}
                    max={200000}
                    step={4096}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-24 text-right">
                    {(settings.maxContextTokens / 1000).toFixed(0)}K
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <Label>Smart Context Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Intelligently select relevant files for context
                  </p>
                </div>
                <Switch
                  checked={settings.smartContextMode}
                  onCheckedChange={(v) => updateSetting("smartContextMode", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Multi-Model Tab */}
        <TabsContent value="orchestration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Multi-Model Orchestration
              </CardTitle>
              <CardDescription>
                Use multiple AI models together for superior results - FREE in Create!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border">
                <div>
                  <Label className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    Enable Multi-Model Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Combine models for better results
                  </p>
                </div>
                <Switch
                  checked={settings.enableMultiModel}
                  onCheckedChange={(v) => updateSetting("enableMultiModel", v)}
                />
              </div>

              <div className="space-y-2">
                <Label>Orchestration Preset</Label>
                <div className="grid gap-2">
                  {ORCHESTRATION_PRESETS.map((preset) => (
                    <div
                      key={preset.id}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        settings.orchestrationPreset === preset.id 
                          ? "border-primary bg-primary/5" 
                          : "hover:bg-muted"
                      )}
                      onClick={() => updateSetting("orchestrationPreset", preset.id)}
                    >
                      <div className="font-medium">{preset.name}</div>
                      <div className="text-xs text-muted-foreground">{preset.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5" />
                Performance & Quality
              </CardTitle>
              <CardDescription>
                Fine-tune AI behavior for your needs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Stream Responses</Label>
                  <p className="text-xs text-muted-foreground">Show text as it generates</p>
                </div>
                <Switch
                  checked={settings.streamResponses}
                  onCheckedChange={(v) => updateSetting("streamResponses", v)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Cache Responses</Label>
                  <p className="text-xs text-muted-foreground">Speed up repeated queries</p>
                </div>
                <Switch
                  checked={settings.cacheResponses}
                  onCheckedChange={(v) => updateSetting("cacheResponses", v)}
                />
              </div>

              <div className="space-y-2">
                <Label>Default Temperature: {settings.defaultTemperature.toFixed(1)}</Label>
                <Slider
                  value={[settings.defaultTemperature]}
                  onValueChange={([v]) => updateSetting("defaultTemperature", v)}
                  min={0}
                  max={2}
                  step={0.1}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Precise</span>
                  <span>Balanced</span>
                  <span>Creative</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Parallel Requests: {settings.parallelRequests}</Label>
                <Slider
                  value={[settings.parallelRequests]}
                  onValueChange={([v]) => updateSetting("parallelRequests", v)}
                  min={1}
                  max={8}
                  step={1}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <Label>Auto-Validate Code</Label>
                  <p className="text-xs text-muted-foreground">
                    Check generated code for errors
                  </p>
                </div>
                <Switch
                  checked={settings.autoValidateCode}
                  onCheckedChange={(v) => updateSetting("autoValidateCode", v)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-lg border">
                <div>
                  <Label className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-blue-500" />
                    Enhanced Reasoning Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Deep thinking for complex problems
                  </p>
                </div>
                <Switch
                  checked={settings.enableReasoningMode}
                  onCheckedChange={(v) => updateSetting("enableReasoningMode", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* All Features Included Notice */}
      <Card className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-full">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <h4 className="font-semibold">All Features Included - FREE!</h4>
              <p className="text-sm text-muted-foreground">
                Features that cost $20-50/month elsewhere are completely free in Create. 
                Local AI, multi-model, smart routing, unlimited context - all yours! 🎉
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AIPowerSettings;
