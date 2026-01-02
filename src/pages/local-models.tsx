import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Server,
  Shield,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Download,
  Copy,
  FileUp,
  Pin,
  PinOff,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
  Database,
  Globe,
  Hash,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

import { trustlessInferenceClient } from "@/ipc/trustless_inference_client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import type {
  LocalModelProvider,
  LocalModelInfo,
  InferenceRecord,
  VerificationResult,
  HeliaNodeStatus,
  InferenceStats,
} from "@/types/trustless_inference";

// ============================================================================
// Provider Status Component
// ============================================================================

function ProviderStatusCard() {
  const { data: providers, isLoading, refetch } = useQuery({
    queryKey: ["trustless-providers"],
    queryFn: () => trustlessInferenceClient.checkProviders(),
    refetchInterval: 30000,
  });

  const providerInfo: Record<LocalModelProvider, { name: string; port: number; color: string }> = {
    ollama: { name: "Ollama", port: 11434, color: "from-blue-500 to-cyan-500" },
    lmstudio: { name: "LM Studio", port: 1234, color: "from-purple-500 to-pink-500" },
    llamacpp: { name: "llama.cpp", port: 8080, color: "from-orange-500 to-yellow-500" },
    vllm: { name: "vLLM", port: 8000, color: "from-green-500 to-emerald-500" },
  };

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
      <CardHeader className="pb-3 relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Server className="h-5 w-5 text-blue-500" />
            </div>
            Local Providers
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="hover:bg-blue-500/10">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 relative">
        {(["ollama", "lmstudio", "llamacpp", "vllm"] as LocalModelProvider[]).map(
          (provider) => (
            <div
              key={provider}
              className={`flex items-center justify-between p-3 rounded-xl transition-all duration-200 ${
                providers?.[provider] 
                  ? "bg-gradient-to-r " + providerInfo[provider].color + " bg-opacity-10 border border-white/10" 
                  : "bg-muted/50 hover:bg-muted/80"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    providers?.[provider] 
                      ? "bg-green-500 shadow-lg shadow-green-500/50 animate-pulse" 
                      : "bg-gray-400"
                  }`}
                />
                <div>
                  <span className="font-semibold">{providerInfo[provider].name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    :{providerInfo[provider].port}
                  </span>
                </div>
              </div>
              <Badge 
                variant={providers?.[provider] ? "default" : "secondary"}
                className={providers?.[provider] ? "bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30" : ""}
              >
                {providers?.[provider] ? "● Online" : "○ Offline"}
              </Badge>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Helia Status Component
// ============================================================================

function HeliaStatusCard() {
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["helia-status"],
    queryFn: () => trustlessInferenceClient.getHeliaStatus(),
    refetchInterval: 10000,
  });

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent" />
      <CardHeader className="pb-3 relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-2 rounded-lg bg-teal-500/10">
              <Globe className="h-5 w-5 text-teal-500" />
            </div>
            IPFS/Helia Node
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="hover:bg-teal-500/10">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 relative">
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
          <span className="text-muted-foreground">Status</span>
          <Badge 
            variant={status?.running ? "default" : "secondary"}
            className={status?.running ? "bg-teal-500/20 text-teal-600 border-teal-500/30" : ""}
          >
            {status?.running ? "● Running" : "○ Stopped"}
          </Badge>
        </div>
        {status?.running && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-teal-500/10 to-transparent border border-teal-500/20">
                <div className="text-2xl font-bold text-teal-600">{status.connectedPeers}</div>
                <div className="text-xs text-muted-foreground">Connected Peers</div>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20">
                <div className="text-2xl font-bold text-emerald-600">{status.storedCids}</div>
                <div className="text-xs text-muted-foreground">Stored CIDs</div>
              </div>
            </div>
            {status.peerId && (
              <div className="space-y-2">
                <span className="text-muted-foreground text-sm">Peer ID</span>
                <code className="block text-xs bg-muted p-3 rounded-xl truncate font-mono">
                  {status.peerId}
                </code>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Model List Component
// ============================================================================

function ModelList({
  onSelectModel,
}: {
  onSelectModel: (provider: LocalModelProvider, modelId: string) => void;
}) {
  const { data: models, isLoading, refetch } = useQuery({
    queryKey: ["trustless-models"],
    queryFn: () => trustlessInferenceClient.listModels(),
  });

  const groupedModels = React.useMemo(() => {
    if (!models) return {};
    return models.reduce(
      (acc, model) => {
        if (!acc[model.provider]) acc[model.provider] = [];
        acc[model.provider].push(model);
        return acc;
      },
      {} as Record<LocalModelProvider, LocalModelInfo[]>
    );
  }, [models]);

  const providerColors: Record<string, { bg: string; text: string; border: string }> = {
    ollama: { bg: "from-blue-500/10", text: "text-blue-500", border: "border-blue-500/20" },
    lmstudio: { bg: "from-purple-500/10", text: "text-purple-500", border: "border-purple-500/20" },
    llamacpp: { bg: "from-orange-500/10", text: "text-orange-500", border: "border-orange-500/20" },
    vllm: { bg: "from-green-500/10", text: "text-green-500", border: "border-green-500/20" },
  };

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent" />
      <CardHeader className="pb-3 relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Cpu className="h-5 w-5 text-cyan-500" />
            </div>
            Available Models
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="hover:bg-cyan-500/10">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="relative">
        <ScrollArea className="h-[300px] pr-2">
          {Object.entries(groupedModels).map(([provider, providerModels]) => {
            const models = providerModels as LocalModelInfo[];
            const colors = providerColors[provider] || providerColors.ollama;
            return (
            <Collapsible key={provider} defaultOpen className="mb-3">
              <CollapsibleTrigger className={`flex items-center gap-2 w-full p-3 hover:bg-muted/50 rounded-xl transition-all border ${colors.border}`}>
                <ChevronDown className={`h-4 w-4 ${colors.text}`} />
                <span className={`font-semibold capitalize ${colors.text}`}>{provider}</span>
                <Badge variant="secondary" className={`ml-auto bg-gradient-to-r ${colors.bg} to-transparent`}>
                  {models.length} models
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 space-y-1 mt-2">
                {models.map((model) => (
                  <div
                    key={`${model.provider}-${model.id}`}
                    className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl cursor-pointer transition-all border border-transparent hover:border-muted group"
                    onClick={() =>
                      onSelectModel(model.provider as LocalModelProvider, model.id)
                    }
                  >
                    <div>
                      <div className="font-medium group-hover:text-primary transition-colors">{model.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {model.parameters} • {model.quantization || "N/A"}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
            );
          })}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="p-3 rounded-full bg-muted mb-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">Loading models...</span>
            </div>
          )}
          {!isLoading && models?.length === 0 && (
            <div className="text-center py-8">
              <div className="p-4 rounded-full bg-muted/50 inline-block mb-3">
                <Cpu className="h-10 w-10 text-muted-foreground/30" />
              </div>
              <p className="font-medium text-muted-foreground">No local models found</p>
              <p className="text-sm text-muted-foreground mt-1">Start Ollama or LM Studio to see models</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Inference Playground
// ============================================================================

function InferencePlayground() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<LocalModelProvider>("ollama");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [enableVerification, setEnableVerification] = useState(true);
  const [output, setOutput] = useState("");
  const [lastRecord, setLastRecord] = useState<{
    recordId?: string;
    cid?: string;
    verified?: boolean;
    modelId?: string;
    modelName?: string;
    provider?: string;
    tokens?: number;
    timeMs?: number;
    timestamp?: number;
  } | null>(null);

  const { data: models } = useQuery({
    queryKey: ["trustless-models"],
    queryFn: () => trustlessInferenceClient.listModels(),
  });

  const availableModels = models?.filter((m) => m.provider === provider) || [];

  const inferenceMutation = useMutation({
    mutationFn: async () => {
      setOutput("");
      setLastRecord(null);

      const result = await trustlessInferenceClient.runInference({
        provider,
        modelId,
        prompt,
        systemPrompt: systemPrompt || undefined,
        config: { temperature, maxTokens },
        skipVerification: !enableVerification,
      });

      return result;
    },
    onSuccess: (result) => {
      setOutput(result.output);
      setLastRecord({
        recordId: result.recordId,
        cid: result.cid,
        verified: result.verified,
        modelId: modelId,
        modelName: availableModels.find((m) => m.id === modelId)?.name || modelId,
        provider: provider,
        tokens: result.tokens,
        timeMs: result.timeMs,
        timestamp: Date.now(),
      });
      queryClient.invalidateQueries({ queryKey: ["inference-records"] });
      toast.success(
        `Inference complete (${result.tokens} tokens, ${result.timeMs}ms)`
      );
    },
    onError: (error) => {
      toast.error(`Inference failed: ${error.message}`);
    },
  });

  const streamMutation = useMutation({
    mutationFn: async () => {
      setOutput("");
      setLastRecord(null);

      await trustlessInferenceClient.streamInference(
        {
          provider,
          modelId,
          messages: [{ role: "user", content: prompt }],
          systemPrompt: systemPrompt || undefined,
          config: { temperature, maxTokens },
        },
        {
          onToken: (content) => {
            setOutput((prev) => prev + content);
          },
          onDone: (data) => {
            setLastRecord({ 
              recordId: data.recordId, 
              cid: data.cid, 
              verified: true,
              modelId: modelId,
              modelName: availableModels.find((m) => m.id === modelId)?.name || modelId,
              provider: provider,
              timestamp: Date.now(),
            });
            queryClient.invalidateQueries({ queryKey: ["inference-records"] });
          },
          onError: (error) => {
            toast.error(`Stream error: ${error}`);
          },
        }
      );
    },
    onError: (error) => {
      toast.error(`Stream failed: ${error.message}`);
    },
  });

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
        <CardHeader className="relative">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-semibold">Inference Playground</span>
              <CardDescription className="mt-0.5">
                Test local models with content-addressed verification
              </CardDescription>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 relative">
          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as LocalModelProvider);
                  setModelId("");
                }}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      Ollama
                    </span>
                  </SelectItem>
                  <SelectItem value="lmstudio">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                      LM Studio
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Model</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* System Prompt */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">System Prompt (optional)</Label>
            <Input
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              className="h-11 rounded-xl"
            />
          </div>

          {/* User Prompt */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt..."
              rows={4}
              className="rounded-xl resize-none"
            />
          </div>

          {/* Parameters */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-muted/50">
            <div className="space-y-3">
              <Label className="text-sm flex items-center justify-between">
                Temperature
                <span className="font-mono text-muted-foreground bg-background px-2 py-0.5 rounded-md text-xs">{temperature.toFixed(2)}</span>
              </Label>
              <Slider
                value={[temperature]}
                onValueChange={([v]) => setTemperature(v)}
                min={0}
                max={2}
                step={0.1}
                className="cursor-pointer"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-sm flex items-center justify-between">
                Max Tokens
                <span className="font-mono text-muted-foreground bg-background px-2 py-0.5 rounded-md text-xs">{maxTokens}</span>
              </Label>
              <Slider
                value={[maxTokens]}
                onValueChange={([v]) => setMaxTokens(v)}
                min={128}
                max={8192}
                step={128}
                className="cursor-pointer"
              />
            </div>
          </div>

          {/* Verification Toggle */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Switch
              checked={enableVerification}
              onCheckedChange={setEnableVerification}
            />
            <Label className="flex items-center gap-2 cursor-pointer">
              <Shield className="h-4 w-4 text-emerald-500" />
              <span className="font-medium">Enable Verification</span>
              <span className="text-muted-foreground text-sm">(IPFS proof)</span>
            </Label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => inferenceMutation.mutate()}
              disabled={
                !modelId || !prompt || inferenceMutation.isPending || streamMutation.isPending
              }
              className="flex-1 h-11 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-lg shadow-violet-500/20"
            >
              {inferenceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Inference
            </Button>
            <Button
              variant="outline"
              onClick={() => streamMutation.mutate()}
              disabled={
                !modelId || !prompt || inferenceMutation.isPending || streamMutation.isPending
              }
              className="flex-1 h-11 rounded-xl border-2 hover:bg-muted/50"
            >
              {streamMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Stream
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Output */}
      {output && (
        <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                </div>
                Output
              </CardTitle>
              {lastRecord && (
                <div className="flex items-center gap-2">
                  {lastRecord.verified !== undefined && (
                    <Badge
                      variant={lastRecord.verified ? "default" : "destructive"}
                      className={`flex items-center gap-1 ${lastRecord.verified ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" : ""}`}
                    >
                      {lastRecord.verified ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <ShieldX className="h-3 w-3" />
                      )}
                      {lastRecord.verified ? "Verified" : "Unverified"}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 relative">
            <div className="bg-muted/50 p-4 rounded-xl whitespace-pre-wrap font-mono text-sm border">
              {output}
            </div>
            
            {/* Verification Hash Details */}
            {lastRecord?.cid && (
              <div className="border rounded-lg p-4 space-y-3 bg-card">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Verification Hash (IPFS CID)
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(lastRecord.cid!);
                      toast.success("Hash copied to clipboard");
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy Hash
                  </Button>
                </div>
                
                {/* Full Hash Display */}
                <div 
                  className="bg-muted p-3 rounded font-mono text-sm break-all cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(lastRecord.cid!);
                    toast.success("Hash copied to clipboard");
                  }}
                  title="Click to copy"
                >
                  {lastRecord.cid}
                </div>
                
                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-muted-foreground text-xs uppercase tracking-wide">Model</div>
                    <div className="font-medium">{lastRecord.modelName || lastRecord.modelId}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground text-xs uppercase tracking-wide">Provider</div>
                    <div className="font-medium capitalize">{lastRecord.provider}</div>
                  </div>
                  {lastRecord.tokens && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Tokens</div>
                      <div className="font-medium">{lastRecord.tokens}</div>
                    </div>
                  )}
                  {lastRecord.timeMs && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Generation Time</div>
                      <div className="font-medium">{lastRecord.timeMs}ms</div>
                    </div>
                  )}
                  {lastRecord.timestamp && (
                    <div className="space-y-1 col-span-2">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Timestamp</div>
                      <div className="font-medium">{new Date(lastRecord.timestamp).toLocaleString()}</div>
                    </div>
                  )}
                  {lastRecord.recordId && (
                    <div className="space-y-1 col-span-2">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Record ID</div>
                      <div className="font-mono text-xs break-all">{lastRecord.recordId}</div>
                    </div>
                  )}
                </div>
                
                {/* Copy All Data Button */}
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    const verificationData = {
                      cid: lastRecord.cid,
                      recordId: lastRecord.recordId,
                      model: {
                        id: lastRecord.modelId,
                        name: lastRecord.modelName,
                        provider: lastRecord.provider,
                      },
                      metrics: {
                        tokens: lastRecord.tokens,
                        generationTimeMs: lastRecord.timeMs,
                      },
                      timestamp: lastRecord.timestamp,
                      timestampISO: lastRecord.timestamp ? new Date(lastRecord.timestamp).toISOString() : undefined,
                      verified: lastRecord.verified,
                    };
                    navigator.clipboard.writeText(JSON.stringify(verificationData, null, 2));
                    toast.success("Full verification data copied to clipboard");
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Full Verification Data (JSON)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Inference Records List
// ============================================================================

function InferenceRecordsList() {
  const queryClient = useQueryClient();
  const [selectedRecord, setSelectedRecord] = useState<InferenceRecord | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(
    null
  );

  const { data: records, isLoading } = useQuery({
    queryKey: ["inference-records"],
    queryFn: () => trustlessInferenceClient.listRecords(50),
  });

  const verifyMutation = useMutation({
    mutationFn: (recordId: string) => trustlessInferenceClient.verifyRecord(recordId),
    onSuccess: (result) => {
      setVerificationResult(result);
      if (result.valid) {
        toast.success("Record verified successfully");
      } else {
        toast.error(`Verification failed: ${result.details.join(", ")}`);
      }
    },
  });

  const pinMutation = useMutation({
    mutationFn: async ({ recordId, pin }: { recordId: string; pin: boolean }) => {
      if (pin) {
        await trustlessInferenceClient.pinRecord(recordId);
      } else {
        await trustlessInferenceClient.unpinRecord(recordId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inference-records"] });
      toast.success("Record updated");
    },
  });

  const exportMutation = useMutation({
    mutationFn: (recordId: string) => trustlessInferenceClient.exportProof(recordId),
    onSuccess: (proof) => {
      navigator.clipboard.writeText(proof);
      toast.success("Proof copied to clipboard");
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Inference Records
          </CardTitle>
          <CardDescription>
            Content-addressed verification proofs for local inference
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : records?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No inference records yet</p>
                <p className="text-sm">Run some inferences to see verification proofs</p>
              </div>
            ) : (
              <div className="space-y-2">
                {records?.map((record) => (
                  <div
                    key={record.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedRecord?.id === record.id
                        ? "border-primary bg-muted"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => {
                      setSelectedRecord(record);
                      setVerificationResult(null);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {record.verified ? (
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                        ) : (
                          <ShieldX className="h-4 w-4 text-red-500" />
                        )}
                        <span className="font-medium">{record.proof.model.name}</span>
                        {record.pinned && <Pin className="h-3 w-3 text-primary" />}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {record.request.prompt.slice(0, 100)}...
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <Badge 
                        variant="outline" 
                        className="cursor-pointer hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(record.cid);
                          toast.success("Hash copied to clipboard");
                        }}
                        title="Click to copy full hash"
                      >
                        <Hash className="h-3 w-3 mr-1" />
                        {record.cid.slice(0, 8)}...{record.cid.slice(-4)}
                      </Badge>
                      <Badge variant="outline">
                        {record.proof.response.tokenCount} tokens
                      </Badge>
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        {record.proof.response.generationTimeMs}ms
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Selected Record Details */}
      {selectedRecord && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Record Details & Verification Hash
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Full Helia Hash Display */}
            <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-semibold text-emerald-600">IPFS Content Hash (CID)</span>
              </div>
              <div 
                className="font-mono text-sm bg-black/20 p-3 rounded cursor-pointer hover:bg-black/30 transition-colors break-all select-all"
                onClick={() => {
                  navigator.clipboard.writeText(selectedRecord.cid);
                  toast.success("Full hash copied to clipboard!");
                }}
                title="Click to copy full hash"
              >
                {selectedRecord.cid}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Click to copy • This cryptographic hash uniquely identifies this inference record on IPFS
              </p>
            </div>

            {/* Verification Metadata Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Model Name</div>
                <div className="font-medium text-sm">{selectedRecord.proof.model.name}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Model ID</div>
                <div className="font-mono text-xs truncate">{selectedRecord.proof.model.id}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Provider</div>
                <div className="font-medium text-sm">{selectedRecord.proof.model.provider}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Version</div>
                <div className="font-mono text-sm">{selectedRecord.proof.version}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Timestamp</div>
                <div className="font-medium text-sm">{new Date(selectedRecord.proof.timestamp).toLocaleString()}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Record ID</div>
                <div className="font-mono text-xs truncate" title={selectedRecord.id}>{selectedRecord.id}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Tokens Generated</div>
                <div className="font-medium text-sm">{selectedRecord.proof.response.tokenCount}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Generation Time</div>
                <div className="font-medium text-sm">{selectedRecord.proof.response.generationTimeMs}ms</div>
              </div>
            </div>

            {/* Copy Full Verification Data Button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const verificationData = {
                  cid: selectedRecord.cid,
                  recordId: selectedRecord.id,
                  verified: selectedRecord.verified,
                  pinned: selectedRecord.pinned,
                  createdAt: selectedRecord.createdAt,
                  model: selectedRecord.proof.model,
                  version: selectedRecord.proof.version,
                  timestamp: selectedRecord.proof.timestamp,
                  response: {
                    tokenCount: selectedRecord.proof.response.tokenCount,
                    generationTimeMs: selectedRecord.proof.response.generationTimeMs,
                    outputHash: selectedRecord.proof.response.outputHash,
                  },
                  request: {
                    promptHash: selectedRecord.proof.request.promptHash,
                  },
                };
                navigator.clipboard.writeText(JSON.stringify(verificationData, null, 2));
                toast.success("Full verification data copied as JSON!");
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Full Verification Data (JSON)
            </Button>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => verifyMutation.mutate(selectedRecord.id)}
                disabled={verifyMutation.isPending}
              >
                {verifyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Shield className="h-4 w-4 mr-1" />
                )}
                Verify
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  pinMutation.mutate({
                    recordId: selectedRecord.id,
                    pin: !selectedRecord.pinned,
                  })
                }
              >
                {selectedRecord.pinned ? (
                  <PinOff className="h-4 w-4 mr-1" />
                ) : (
                  <Pin className="h-4 w-4 mr-1" />
                )}
                {selectedRecord.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportMutation.mutate(selectedRecord.id)}
              >
                <Copy className="h-4 w-4 mr-1" />
                Export Proof
              </Button>
            </div>

            {/* Verification Result */}
            {verificationResult && (
              <div
                className={`p-3 rounded-lg ${
                  verificationResult.valid ? "bg-green-500/10" : "bg-red-500/10"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {verificationResult.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <span className="font-medium">
                    {verificationResult.valid
                      ? "Verification Passed"
                      : "Verification Failed"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(verificationResult.checks).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      {value ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-500" />
                      )}
                      <span className="capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                    </div>
                  ))}
                </div>
                {verificationResult.warnings.length > 0 && (
                  <div className="mt-2 text-sm text-yellow-600">
                    Warnings: {verificationResult.warnings.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Proof Details */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
                <ChevronRight className="h-4 w-4" />
                Full Proof Details (Raw JSON)
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[300px]">
                  {JSON.stringify(selectedRecord.proof, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Statistics Card
// ============================================================================

function StatsCard() {
  const { data: stats } = useQuery({
    queryKey: ["trustless-stats"],
    queryFn: () => trustlessInferenceClient.getStats(),
    refetchInterval: 30000,
  });

  if (!stats) return null;

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent" />
      <CardHeader className="pb-3 relative">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Info className="h-5 w-5 text-purple-500" />
          </div>
          Statistics
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20">
            <div className="text-2xl font-bold text-blue-600">{stats.totalInferences}</div>
            <div className="text-xs text-muted-foreground">Total Inferences</div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-green-500/10 to-transparent border border-green-500/20">
            <div className="text-2xl font-bold text-green-600">{stats.verifiedInferences}</div>
            <div className="text-xs text-muted-foreground">Verified</div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20">
            <div className="text-2xl font-bold text-amber-600">{stats.pinnedRecords}</div>
            <div className="text-xs text-muted-foreground">Pinned Records</div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20">
            <div className="text-2xl font-bold text-purple-600">
              {stats.averageGenerationTimeMs.toFixed(0)}<span className="text-sm font-normal">ms</span>
            </div>
            <div className="text-xs text-muted-foreground">Avg Latency</div>
          </div>
        </div>
        {Object.keys(stats.modelUsage).length > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-muted/50">
            <div className="text-sm font-medium mb-2">Model Usage</div>
            <div className="space-y-2">
              {Object.entries(stats.modelUsage).map(([model, count]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="truncate text-muted-foreground">{model}</span>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">{count as number}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function LocalModelsPage() {
  const [selectedModel, setSelectedModel] = useState<{
    provider: LocalModelProvider;
    modelId: string;
  } | null>(null);

  // Initialize service on mount
  useEffect(() => {
    trustlessInferenceClient.initialize().catch(console.error);
    return () => {
      trustlessInferenceClient.shutdown().catch(console.error);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-emerald-500/5">
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Hero Header */}
        <div className="mb-8 relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent rounded-3xl blur-3xl" />
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                  <Shield className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                    Trustless Local Inference
                  </h1>
                  <p className="text-muted-foreground mt-0.5">
                    Run AI models locally with content-addressed verification via IPFS/Helia
                  </p>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm text-emerald-600 font-medium">Verification Active</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="playground" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 rounded-xl border">
            <TabsTrigger 
              value="playground" 
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-6 transition-all"
            >
              <Play className="h-4 w-4 mr-2" />
              Playground
            </TabsTrigger>
            <TabsTrigger 
              value="records"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-6 transition-all"
            >
              <Database className="h-4 w-4 mr-2" />
              Records
            </TabsTrigger>
            <TabsTrigger 
              value="status"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-6 transition-all"
            >
              <Server className="h-4 w-4 mr-2" />
              Status
            </TabsTrigger>
          </TabsList>

          <TabsContent value="playground" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <InferencePlayground />
              </div>
              <div className="space-y-4">
                <ModelList onSelectModel={(p, m) => setSelectedModel({ provider: p, modelId: m })} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="records">
            <InferenceRecordsList />
          </TabsContent>

          <TabsContent value="status" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <ProviderStatusCard />
              <HeliaStatusCard />
              <StatsCard />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
