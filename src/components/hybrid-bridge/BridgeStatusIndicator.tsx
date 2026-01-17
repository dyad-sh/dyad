/**
 * Hybrid Bridge Status Indicator
 * Shows connection status with auto-reconnect feedback
 */

import { useState } from "react";
import { useHybridBridge, useN8nHealth, getConnectionStatusInfo } from "@/hooks/useHybridBridge";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Cloud,
  CloudOff,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  PlayCircle,
  StopCircle,
  Zap,
} from "lucide-react";

export interface BridgeStatusIndicatorProps {
  className?: string;
  showLabel?: boolean;
  autoStart?: boolean;
}

export function BridgeStatusIndicator({
  className,
  showLabel = false,
  autoStart = true,
}: BridgeStatusIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    status,
    isConnected,
    isHealthy,
    connectionState,
    start,
    stop,
    restartN8n,
    isStarting,
    isStopping,
    isN8nRestarting,
    lastEvent,
    error,
  } = useHybridBridge({ autoStart });

  const n8nHealth = useN8nHealth();
  const statusInfo = getConnectionStatusInfo(connectionState);

  const getStatusIcon = () => {
    if (isStarting || isStopping || isN8nRestarting) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    if (isHealthy) {
      return <Zap className="h-4 w-4 text-green-500" />;
    }
    if (isConnected) {
      return <Wifi className="h-4 w-4 text-yellow-500" />;
    }
    if (connectionState === "error") {
      return <WifiOff className="h-4 w-4 text-red-500" />;
    }
    return <CloudOff className="h-4 w-4 text-gray-400" />;
  };

  const getStatusColor = () => {
    if (isHealthy) return "bg-green-500";
    if (isConnected) return "bg-yellow-500";
    if (connectionState === "error") return "bg-red-500";
    if (connectionState === "connecting" || connectionState === "reconnecting") return "bg-yellow-500 animate-pulse";
    return "bg-gray-400";
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "relative gap-2 px-2 h-8",
            className
          )}
        >
          {getStatusIcon()}
          {showLabel && (
            <span className="text-xs">
              {statusInfo.label}
            </span>
          )}
          {/* Status dot */}
          <span
            className={cn(
              "absolute bottom-1 right-1 h-2 w-2 rounded-full",
              getStatusColor()
            )}
          />
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm">Hybrid Bridge Status</h4>
            <Badge variant={isHealthy ? "default" : isConnected ? "secondary" : "destructive"}>
              {statusInfo.label}
            </Badge>
          </div>

          {/* n8n Status */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">n8n Engine</span>
              </div>
              <div className="flex items-center gap-2">
                {status?.n8n?.running ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {status?.n8n?.running ? "Running" : "Stopped"}
                </span>
              </div>
            </div>

            {/* Health metrics */}
            {n8nHealth.health && (
              <div className="bg-muted/50 rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Latency</span>
                  <span>{n8nHealth.health.latencyMs?.toFixed(0) || "--"}ms</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Last check</span>
                  <span>
                    {n8nHealth.health.lastCheck
                      ? new Date(n8nHealth.health.lastCheck).toLocaleTimeString()
                      : "--"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Errors</span>
                  <span>{n8nHealth.health.errorCount || 0}</span>
                </div>
              </div>
            )}

            {/* Workflows count */}
            {status?.n8n && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Workflows</span>
                </div>
                <span className="text-sm">
                  {status.n8n.activeWorkflows}/{status.n8n.workflowCount} active
                </span>
              </div>
            )}

            {/* Services */}
            {status?.services && status.services.length > 0 && (
              <>
                <Separator className="my-2" />
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Connected Services</span>
                  {status.services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cloud className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">{service.name}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] h-5">
                        {service.type}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Last Event */}
            {lastEvent && (
              <>
                <Separator className="my-2" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="truncate">Last: {lastEvent.type}</span>
                </div>
              </>
            )}

            {/* Error display */}
            {error && (
              <div className="bg-red-500/10 text-red-500 rounded-lg p-2 text-xs">
                {(error as Error).message || "Connection error"}
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Actions */}
        <div className="p-2 flex gap-2">
          {!isConnected ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 h-8"
              onClick={() => start({})}
              disabled={isStarting}
            >
              {isStarting ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-3 w-3 mr-2" />
              )}
              Start Bridge
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8"
                onClick={() => restartN8n()}
                disabled={isN8nRestarting}
              >
                {isN8nRestarting ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-2" />
                )}
                Restart
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="flex-1 h-8"
                onClick={() => stop()}
                disabled={isStopping}
              >
                {isStopping ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <StopCircle className="h-3 w-3 mr-2" />
                )}
                Stop
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default BridgeStatusIndicator;
