/**
 * OpenClaw CNS Settings Component
 * 
 * Settings panel for CNS configuration integrated into the settings page.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  Cpu,
  Workflow,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useCNSStatus,
  useCNSConfig,
  useOllama,
  useN8nConnections,
} from "@/hooks/useOpenClawCNS";

export function CNSSettings() {
  const { 
    isInitialized, 
    initialize, 
    shutdown,
    isInitializing, 
    ollamaAvailable, 
    n8nConnected 
  } = useCNSStatus();
  
  const { config, updateConfig, isUpdating } = useCNSConfig();
  const { checkHealth, isRefreshing, models } = useOllama();
  const { connections } = useN8nConnections();

  const handleInitialize = async () => {
    try {
      await initialize({});
      toast.success("CNS initialized successfully");
    } catch {
      toast.error("Failed to initialize CNS");
    }
  };

  const handleShutdown = async () => {
    try {
      await shutdown();
      toast.success("CNS shut down");
    } catch {
      toast.error("Failed to shut down CNS");
    }
  };

  const handleCheckOllama = async () => {
    try {
      await checkHealth();
      toast.success(ollamaAvailable ? "Ollama is running" : "Ollama not detected");
    } catch {
      toast.error("Failed to check Ollama status");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  OpenClaw CNS
                  <Badge variant="outline" className="text-xs">🦞</Badge>
                </CardTitle>
                <CardDescription>
                  Central Nervous System for AI operations
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isInitialized ? (
                <>
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                  <Button variant="outline" size="sm" onClick={handleShutdown}>
                    Shutdown
                  </Button>
                </>
              ) : (
                <>
                  <Badge variant="secondary">
                    <XCircle className="h-3 w-3 mr-1" />
                    Inactive
                  </Badge>
                  <Button size="sm" onClick={handleInitialize} disabled={isInitializing}>
                    {isInitializing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Initialize
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Ollama Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-green-500" />
              <CardTitle className="text-base">Ollama (Local AI)</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={ollamaAvailable ? "default" : "secondary"}>
                {ollamaAvailable ? "Connected" : "Not Running"}
              </Badge>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCheckOllama}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <CardDescription>
            Connect to Ollama for local AI inference. Run{" "}
            <code className="bg-muted px-1 rounded">ollama serve</code> to start.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Prefer Local Processing</Label>
              <p className="text-xs text-muted-foreground">
                Route AI requests to Ollama when available
              </p>
            </div>
            <Switch
              checked={config?.preferLocal ?? true}
              onCheckedChange={(checked) => updateConfig({ preferLocal: checked })}
              disabled={isUpdating}
            />
          </div>

          {ollamaAvailable && models.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Available Models</Label>
                <div className="grid grid-cols-2 gap-2">
                  {models.slice(0, 6).map((model: { name: string; size: number }) => (
                    <div
                      key={model.name}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                    >
                      <span className="truncate">{model.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(model.size / 1e9).toFixed(1)}GB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ollama URL</Label>
              <p className="text-xs text-muted-foreground">
                Override default Ollama endpoint
              </p>
            </div>
            <Input
              value={config?.ollamaUrl ?? "http://localhost:11434"}
              onChange={(e) => updateConfig({ ollamaUrl: e.target.value })}
              className="w-64"
              placeholder="http://localhost:11434"
              disabled={isUpdating}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Complexity Threshold</Label>
              <p className="text-xs text-muted-foreground">
                Tasks above this score use cloud AI (1-10)
              </p>
            </div>
            <Input
              type="number"
              value={config?.complexityThreshold ?? 7}
              onChange={(e) => updateConfig({ complexityThreshold: Number(e.target.value) })}
              className="w-20"
              min={1}
              max={10}
              disabled={isUpdating}
            />
          </div>
        </CardContent>
      </Card>

      {/* N8n Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-purple-500" />
              <CardTitle className="text-base">n8n (Workflow Automation)</CardTitle>
            </div>
            <Badge variant={n8nConnected ? "default" : "secondary"}>
              {connections.length} connection{connections.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <CardDescription>
            Connect to n8n for workflow automation and event handling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Workflow Triggers</Label>
              <p className="text-xs text-muted-foreground">
                Allow CNS to trigger n8n workflows automatically
              </p>
            </div>
            <Switch
              checked={config?.enableWorkflows ?? true}
              onCheckedChange={(checked) => updateConfig({ enableWorkflows: checked })}
              disabled={isUpdating}
            />
          </div>

          {connections.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Connected Instances</Label>
                {connections.map((conn: { id: string; name: string; baseUrl: string; status?: string }) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        conn.status === "connected" ? "bg-green-500" : "bg-gray-400"
                      )} />
                      <span className="text-sm font-medium">{conn.name}</span>
                    </div>
                    <a
                      href={conn.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {conn.baseUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}

          <Button variant="outline" size="sm" className="w-full" asChild>
            <a href="/workflows" className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Manage n8n Connections
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced Settings</CardTitle>
          <CardDescription>
            Fine-tune CNS behavior and performance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Streaming</Label>
              <p className="text-xs text-muted-foreground">
                Stream AI responses in real-time
              </p>
            </div>
            <Switch
              checked={config?.enableStreaming ?? true}
              onCheckedChange={(checked) => updateConfig({ enableStreaming: checked })}
              disabled={isUpdating}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Debug Mode</Label>
              <p className="text-xs text-muted-foreground">
                Log detailed CNS operations to console
              </p>
            </div>
            <Switch
              checked={config?.debug ?? false}
              onCheckedChange={(checked) => updateConfig({ debug: checked })}
              disabled={isUpdating}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Max Concurrent Requests</Label>
              <p className="text-xs text-muted-foreground">
                Limit parallel AI requests
              </p>
            </div>
            <Input
              type="number"
              value={config?.maxConcurrentRequests ?? 5}
              onChange={(e) => updateConfig({ maxConcurrentRequests: Number(e.target.value) })}
              className="w-20"
              min={1}
              max={20}
              disabled={isUpdating}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default CNSSettings;
