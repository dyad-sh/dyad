/**
 * External Services Settings Component
 * 
 * Settings panel for managing external services (n8n, Celestia, Ollama).
 * Provides start/stop buttons for each service.
 */

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Play,
  Square,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Workflow,
  Globe,
  Cpu,
  ExternalLink,
  Rocket,
  Network,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useExternalServices } from "@/hooks/useExternalServices";
import type { ServiceId, ServiceStatus, TailscaleStatus, TailscaleConfig } from "@/ipc/services_client";
import { servicesClient } from "@/ipc/services_client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Service icons mapping
const SERVICE_ICONS: Record<ServiceId, React.ElementType> = {
  n8n: Workflow,
  celestia: Globe,
  ollama: Cpu,
};

// Service colors
const SERVICE_COLORS: Record<ServiceId, string> = {
  n8n: "text-orange-500",
  celestia: "text-purple-500",
  ollama: "text-green-500",
};

interface ServiceCardProps {
  serviceId: ServiceId;
  status: ServiceStatus | undefined;
  description: string;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  isPending: boolean;
}

function ServiceCard({
  serviceId,
  status,
  description,
  onStart,
  onStop,
  onRestart,
  isPending,
}: ServiceCardProps) {
  const Icon = SERVICE_ICONS[serviceId] || Cpu;
  const colorClass = SERVICE_COLORS[serviceId] || "text-gray-500";
  const isRunning = status?.running ?? false;
  
  const formatUptime = (startedAt?: number) => {
    if (!startedAt) return null;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className={cn("p-2 rounded-lg bg-muted", colorClass)}>
          <Icon className="h-5 w-5" />
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{status?.name || serviceId}</span>
            <Badge 
              variant={isRunning ? "default" : "secondary"}
              className={cn(
                "text-xs",
                isRunning ? "bg-green-500/10 text-green-500 border-green-500/20" : ""
              )}
            >
              {isRunning ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Running</>
              ) : (
                <><XCircle className="h-3 w-3 mr-1" /> Stopped</>
              )}
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground">{description}</p>
          
          {isRunning && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {status?.port && (
                <span>Port: {status.port}</span>
              )}
              {status?.pid && (
                <span>PID: {status.pid}</span>
              )}
              {status?.startedAt && (
                <span>Uptime: {formatUptime(status.startedAt)}</span>
              )}
            </div>
          )}
          
          {status?.error && (
            <p className="text-xs text-red-500">{status.error}</p>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {isRunning ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onRestart}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Restart</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onStop}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Stop</span>
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={onStart}
            disabled={isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span className="ml-2">Start</span>
          </Button>
        )}
      </div>
    </div>
  );
}

export function ExternalServicesSettings() {
  const {
    services,
    isLoading,
    isRefetching,
    isPending,
    startService,
    stopService,
    restartService,
    startAllServices,
    stopAllServices,
    refetch,
    getServiceStatus,
  } = useExternalServices();

  const runningCount = services.filter((s) => s.running).length;
  const totalCount = services.length;

  const serviceDescriptions: Record<ServiceId, string> = {
    n8n: "Visual workflow automation for AI agents and integrations",
    celestia: "Decentralized data availability layer (via WSL)",
    ollama: "Local LLM inference server for private AI",
  };

  if (isLoading) {
    return (
      <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            External Services
          </CardTitle>
          <CardDescription>Loading service status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <TailscaleSettings />
      </>
    );
  }

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              External Services
            </CardTitle>
            <CardDescription className="mt-1">
              Manage background services for AI, automation, and decentralization
            </CardDescription>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">
              {runningCount}/{totalCount} running
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Quick Actions */}
        <div className="flex items-center gap-2 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startAllServices()}
            disabled={isPending || runningCount === totalCount}
          >
            <Play className="h-4 w-4 mr-2" />
            Start All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => stopAllServices()}
            disabled={isPending || runningCount === 0}
          >
            <Square className="h-4 w-4 mr-2" />
            Stop All
          </Button>
        </div>
        
        <Separator />
        
        {/* Service Cards */}
        <div className="space-y-3">
          {(["n8n", "celestia", "ollama"] as ServiceId[]).map((serviceId) => (
            <ServiceCard
              key={serviceId}
              serviceId={serviceId}
              status={getServiceStatus(serviceId)}
              description={serviceDescriptions[serviceId]}
              onStart={() => startService(serviceId)}
              onStop={() => stopService(serviceId)}
              onRestart={() => restartService(serviceId)}
              isPending={isPending}
            />
          ))}
        </div>
        
        <Separator />
        
        {/* Help Text */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <strong>n8n:</strong> Access at{" "}
            <a 
              href="http://localhost:5678" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              localhost:5678
            </a>
          </p>
          <p className="flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <strong>Celestia:</strong> RPC at{" "}
            <span className="font-mono">localhost:26658</span> (requires WSL)
          </p>
          <p className="flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <strong>Ollama:</strong> API at{" "}
            <span className="font-mono">localhost:11434</span>
          </p>
        </div>
      </CardContent>
    </Card>

    {/* Tailscale VPN Section */}
    <TailscaleSettings />
    </>
  );
}

// =============================================================================
// TAILSCALE SETTINGS
// =============================================================================

function TailscaleSettings() {
  const queryClient = useQueryClient();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const { data: tsStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["tailscale", "status"],
    queryFn: () => servicesClient.getTailscaleStatus(),
    refetchInterval: 30_000,
  });

  const { data: tsConfig } = useQuery({
    queryKey: ["tailscale", "config"],
    queryFn: () => servicesClient.getTailscaleConfig(),
  });

  const { data: serviceUrls } = useQuery({
    queryKey: ["tailscale", "service-urls"],
    queryFn: () => servicesClient.getServiceUrls(),
    enabled: !!tsConfig?.enabled,
  });

  const saveConfig = useMutation({
    mutationFn: (config: TailscaleConfig) =>
      servicesClient.saveTailscaleConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tailscale"] });
    },
  });

  const refreshStatus = useMutation({
    mutationFn: () => servicesClient.getTailscaleStatus(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tailscale", "status"] });
    },
  });

  const handleToggleEnabled = (enabled: boolean) => {
    if (!tsConfig) return;
    saveConfig.mutate({ ...tsConfig, enabled });
  };

  const handleToggleExpose = (exposeServices: boolean) => {
    if (!tsConfig) return;
    saveConfig.mutate({ ...tsConfig, exposeServices });
  };

  const handleToggleService = (
    service: keyof TailscaleConfig["exposedServices"],
    value: boolean,
  ) => {
    if (!tsConfig) return;
    saveConfig.mutate({
      ...tsConfig,
      exposedServices: { ...tsConfig.exposedServices, [service]: value },
    });
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Tailscale VPN
            </CardTitle>
            <CardDescription className="mt-1">
              Access services from any device on your tailnet
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {tsStatus?.running ? (
              <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
              </Badge>
            ) : tsStatus?.installed ? (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" /> Not Running
              </Badge>
            ) : (
              <Badge variant="outline">Not Installed</Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshStatus.mutate()}
              disabled={refreshStatus.isPending}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  refreshStatus.isPending && "animate-spin",
                )}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !tsStatus?.installed ? (
          <div className="text-sm text-muted-foreground p-4 rounded-lg bg-muted">
            <p>
              Tailscale is not installed.{" "}
              <a
                href="https://tailscale.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                Download Tailscale
              </a>{" "}
              to access your services from any device.
            </p>
          </div>
        ) : (
          <>
            {/* Status Info */}
            {tsStatus.running && (
              <div className="text-sm space-y-1 p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Tailnet IP:</span>
                  <span className="font-mono font-medium">
                    {tsStatus.tailnetIp}
                  </span>
                </div>
                {tsStatus.hostname && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Hostname:</span>
                    <span className="font-mono">{tsStatus.hostname}</span>
                  </div>
                )}
                {tsStatus.tailnetName && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Tailnet:</span>
                    <span className="font-mono">{tsStatus.tailnetName}</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <Label htmlFor="ts-enabled" className="flex flex-col gap-1">
                <span>Enable Tailscale Integration</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Use tailnet for service discovery
                </span>
              </Label>
              <Switch
                id="ts-enabled"
                checked={tsConfig?.enabled ?? false}
                onCheckedChange={handleToggleEnabled}
                disabled={!tsStatus.running}
              />
            </div>

            {tsConfig?.enabled && (
              <>
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="ts-expose"
                    className="flex flex-col gap-1"
                  >
                    <span>Expose Services on Tailnet</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      Make local services accessible from other devices
                    </span>
                  </Label>
                  <Switch
                    id="ts-expose"
                    checked={tsConfig.exposeServices}
                    onCheckedChange={handleToggleExpose}
                  />
                </div>

                {tsConfig.exposeServices && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">
                        Exposed Services
                      </Label>
                      {(
                        [
                          { key: "ollama" as const, label: "Ollama", port: 11434 },
                          { key: "n8n" as const, label: "n8n", port: 5678 },
                          { key: "celestia" as const, label: "Celestia", port: 26658 },
                          { key: "openclaw" as const, label: "OpenClaw", port: 18790 },
                        ] as const
                      ).map(({ key, label, port }) => (
                        <div
                          key={key}
                          className="flex items-center justify-between pl-2"
                        >
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={
                                tsConfig.exposedServices[key] ?? true
                              }
                              onCheckedChange={(v) =>
                                handleToggleService(key, v)
                              }
                            />
                            <span className="text-sm">{label}</span>
                          </div>
                          {serviceUrls?.[key]?.tailnet && (
                            <button
                              type="button"
                              onClick={() =>
                                copyUrl(serviceUrls[key].tailnet!)
                              }
                              className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {serviceUrls[key].tailnet}
                              {copiedUrl === serviceUrls[key].tailnet ? (
                                <Check className="h-3 w-3 text-green-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ExternalServicesSettings;
