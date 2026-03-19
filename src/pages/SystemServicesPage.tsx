import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import {
  Activity,
  Circle,
  Play,
  Square,
  RefreshCw,
  Server,
  Brain,
  Network,
  Database,
  Workflow,
  Radio,
  ExternalLink,
  FileText,
} from "lucide-react";

interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "offline" | "unknown";
  port?: number;
  details?: string;
  lastCheck: number;
}

interface ExecutorStatus {
  running: boolean;
  activeTaskCount: number;
  activeTasks: string[];
  pollIntervalMs: number;
  totalExecuted: number;
  totalSucceeded: number;
  totalFailed: number;
}

const statusColors: Record<string, string> = {
  healthy: "text-green-500",
  degraded: "text-yellow-500",
  offline: "text-red-500",
  unknown: "text-gray-400",
};

const statusBg: Record<string, string> = {
  healthy: "bg-green-500/10 border-green-500/30",
  degraded: "bg-yellow-500/10 border-yellow-500/30",
  offline: "bg-red-500/10 border-red-500/30",
  unknown: "bg-gray-500/10 border-gray-500/30",
};

const serviceIcons: Record<string, React.ReactNode> = {
  Ollama: <Brain className="w-5 h-5" />,
  n8n: <Workflow className="w-5 h-5" />,
  Celestia: <Radio className="w-5 h-5" />,
  "OpenClaw Gateway": <Network className="w-5 h-5" />,
  "Inference Bridge": <Server className="w-5 h-5" />,
  "Task Executor": <Activity className="w-5 h-5" />,
  LibreOffice: <FileText className="w-5 h-5" />,
};

export function SystemServicesPage() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();

  const {
    data: services = [],
    isLoading: servicesLoading,
    refetch: refetchServices,
  } = useQuery<ServiceHealth[]>({
    queryKey: ["system-services-health"],
    queryFn: () => ipc.getSystemServicesHealth(),
    refetchInterval: 10_000,
  });

  const {
    data: executorStatus,
    isLoading: executorLoading,
    refetch: refetchExecutor,
  } = useQuery<ExecutorStatus>({
    queryKey: ["task-executor-status"],
    queryFn: () => ipc.getTaskExecutorStatus(),
    refetchInterval: 5_000,
  });

  const startMutation = useMutation({
    mutationFn: () => ipc.startTaskExecutor(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-executor-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-services-health"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => ipc.stopTaskExecutor(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-executor-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-services-health"] });
    },
  });

  const handleRefresh = useCallback(() => {
    refetchServices();
    refetchExecutor();
  }, [refetchServices, refetchExecutor]);

  const healthyCount = services.filter((s) => s.status === "healthy").length;
  const totalCount = services.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-2xl font-bold">System Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {healthyCount}/{totalCount} services healthy
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Task Executor Control Panel */}
        <div className="border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-500" />
              <div>
                <h2 className="text-lg font-semibold">
                  Autonomous Task Executor
                </h2>
                <p className="text-sm text-muted-foreground">
                  Background loop that processes kanban tasks through the full
                  pipeline
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {executorStatus?.running ? (
                <button
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500/10 text-red-500 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-500/10 text-green-500 border border-green-500/30 rounded-md hover:bg-green-500/20 transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Start
                </button>
              )}
            </div>
          </div>

          {executorStatus && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard
                label="Status"
                value={executorStatus.running ? "Running" : "Stopped"}
                color={executorStatus.running ? "text-green-500" : "text-red-500"}
              />
              <StatCard
                label="Active Tasks"
                value={String(executorStatus.activeTaskCount)}
              />
              <StatCard
                label="Total Executed"
                value={String(executorStatus.totalExecuted)}
              />
              <StatCard
                label="Succeeded"
                value={String(executorStatus.totalSucceeded)}
                color="text-green-500"
              />
              <StatCard
                label="Failed"
                value={String(executorStatus.totalFailed)}
                color={
                  executorStatus.totalFailed > 0
                    ? "text-red-500"
                    : "text-muted-foreground"
                }
              />
            </div>
          )}
        </div>

        {/* Pipeline Diagram */}
        <div className="border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-4">Autonomous Pipeline</h2>
          <div className="flex items-center justify-between gap-2 overflow-x-auto py-2">
            {[
              { label: "Kanban Task", icon: "📋", desc: "in_progress + unstarted" },
              { label: "Ollama Inference", icon: "🧠", desc: "Local AI processing" },
              { label: "IPLD Receipt", icon: "📜", desc: "Content-addressed proof" },
              { label: "Celestia DA", icon: "🌌", desc: "Data availability layer" },
              { label: "n8n Workflow", icon: "⚡", desc: "Automation trigger" },
              { label: "Completed", icon: "✅", desc: "Task done" },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center min-w-[100px]">
                  <span className="text-2xl mb-1">{step.icon}</span>
                  <span className="text-xs font-medium text-center">
                    {step.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">
                    {step.desc}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <span className="text-muted-foreground text-lg">→</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Services Grid */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Service Health</h2>
          {servicesLoading ? (
            <div className="text-muted-foreground text-sm">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((service) => (
                <ServiceCard key={service.name} service={service} />
              ))}
            </div>
          )}
        </div>

        {/* Quick Launch */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Quick Launch</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <QuickLaunchCard
              name="n8n Dashboard"
              description="Visual workflow automation & AI agent builder"
              icon={<Workflow className="w-5 h-5" />}
              url="http://localhost:5678"
              status={services.find((s) => s.name === "n8n")?.status}
            />
            <QuickLaunchCard
              name="OpenClaw Gateway"
              description="AI gateway with multi-provider routing"
              icon={<Network className="w-5 h-5" />}
              url="http://localhost:18789/status"
              status={services.find((s) => s.name === "OpenClaw Gateway")?.status}
            />
            <QuickLaunchCard
              name="Ollama API"
              description="Local LLM inference server"
              icon={<Brain className="w-5 h-5" />}
              url="http://localhost:11434"
              status={services.find((s) => s.name === "Ollama")?.status}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  const dashboardUrl = SERVICE_DASHBOARD_URLS[service.name];

  return (
    <div className={`border rounded-lg p-4 ${statusBg[service.status]}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {serviceIcons[service.name] ?? <Server className="w-5 h-5" />}
          <span className="font-medium">{service.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Circle
            className={`w-2.5 h-2.5 fill-current ${statusColors[service.status]}`}
          />
          <span
            className={`text-xs font-medium capitalize ${statusColors[service.status]}`}
          >
            {service.status}
          </span>
        </div>
      </div>
      {service.port && (
        <p className="text-xs text-muted-foreground">Port: {service.port}</p>
      )}
      {service.details && (
        <p className="text-xs text-muted-foreground mt-1">{service.details}</p>
      )}
      {dashboardUrl && service.status === "healthy" && (
        <button
          type="button"
          onClick={() => IpcClient.getInstance().openExternalUrl(dashboardUrl)}
          className="mt-3 flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open Dashboard
        </button>
      )}
    </div>
  );
}

// Map service names to their dashboard URLs
const SERVICE_DASHBOARD_URLS: Record<string, string> = {
  n8n: "http://localhost:5678",
  Ollama: "http://localhost:11434",
  "OpenClaw Gateway": "http://localhost:18789/status",
};

function QuickLaunchCard({
  name,
  description,
  icon,
  url,
  status,
}: {
  name: string;
  description: string;
  icon: React.ReactNode;
  url: string;
  status?: string;
}) {
  const isHealthy = status === "healthy";

  return (
    <button
      type="button"
      onClick={() => IpcClient.getInstance().openExternalUrl(url)}
      className={`border rounded-lg p-4 text-left transition-all ${
        isHealthy
          ? "hover:bg-accent/50 hover:border-blue-500/30 cursor-pointer"
          : "opacity-60 cursor-not-allowed"
      }`}
      disabled={!isHealthy}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-blue-500">{icon}</div>
          <span className="font-medium">{name}</span>
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <Circle
          className={`w-2 h-2 fill-current ${
            isHealthy ? "text-green-500" : "text-red-500"
          }`}
        />
        <span className="text-[10px] text-muted-foreground">
          {isHealthy ? "Running" : status ?? "Offline"}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {url.replace("http://", "")}
        </span>
      </div>
    </button>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="border rounded-md p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color ?? ""}`}>{value}</p>
    </div>
  );
}
