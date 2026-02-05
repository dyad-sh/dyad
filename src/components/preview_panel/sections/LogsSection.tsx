import { useState } from "react";
import { FileText, AlertCircle, RefreshCw } from "lucide-react";
import { useEdgeLogs } from "@/hooks/useEdgeLogs";
import { useProjectLogs } from "@/hooks/useProjectLogs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { LogSource } from "@/ipc/types/supabase";

interface LogsSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const LOG_SOURCES: { value: LogSource | "edge-legacy"; label: string }[] = [
  { value: "edge-legacy", label: "Edge Functions" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "auth", label: "Auth" },
  { value: "postgrest", label: "API" },
];

function LogEntries({
  logs,
  emptyLabel,
}: {
  logs: LogEntry[];
  emptyLabel: string;
}) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <FileText className="w-12 h-12 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-medium mb-2">No Logs Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 font-mono text-xs space-y-0.5">
      {logs.map((log, index) => (
        <div
          key={`${log.timestamp}-${index}`}
          className={cn(
            "px-2 py-1 rounded flex gap-3",
            log.level === "error" && "bg-red-950/50 text-red-400",
            log.level === "warn" && "bg-yellow-950/50 text-yellow-400",
            log.level === "info" && "text-zinc-300",
            log.level === "debug" && "text-zinc-500",
          )}
        >
          <span className="text-zinc-500 shrink-0">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <span
            className={cn(
              "uppercase w-12 shrink-0",
              log.level === "error" && "text-red-500",
              log.level === "warn" && "text-yellow-500",
              log.level === "info" && "text-blue-500",
              log.level === "debug" && "text-zinc-600",
            )}
          >
            {log.level}
          </span>
          <span className="break-all">{log.message}</span>
        </div>
      ))}
    </div>
  );
}

function EdgeLogsTab({
  projectId,
  organizationSlug,
  autoRefresh,
}: {
  projectId: string;
  organizationSlug: string | null;
  autoRefresh: boolean;
}) {
  const {
    data: logs,
    isLoading,
    error,
  } = useEdgeLogs({
    projectId,
    organizationSlug,
    enabled: true,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load logs</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <LogEntries
      logs={logs ?? []}
      emptyLabel="Edge Function logs will appear here when your functions are invoked."
    />
  );
}

function ProjectLogsTab({
  projectId,
  organizationSlug,
  source,
  autoRefresh,
  emptyLabel,
}: {
  projectId: string;
  organizationSlug: string | null;
  source: LogSource;
  autoRefresh: boolean;
  emptyLabel: string;
}) {
  const {
    data: logs,
    isLoading,
    error,
  } = useProjectLogs({
    projectId,
    organizationSlug,
    source,
    enabled: true,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load logs</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <LogEntries logs={logs ?? []} emptyLabel={emptyLabel} />;
}

export function LogsSection({ projectId, organizationSlug }: LogsSectionProps) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeSource, setActiveSource] = useState<string>("edge-legacy");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <h3 className="text-sm font-medium">Logs</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="h-7 text-xs"
          >
            <RefreshCw
              className={cn("h-3 w-3 mr-1", autoRefresh && "animate-spin")}
            />
            {autoRefresh ? "Auto-refresh On" : "Auto-refresh"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeSource}
        onValueChange={setActiveSource}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <div className="border-b border-border px-2 py-1.5 bg-muted/20">
          <TabsList className="h-8">
            {LOG_SOURCES.map((source) => (
              <TabsTrigger
                key={source.value}
                value={source.value}
                className="text-xs px-3 h-7"
              >
                {source.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent
          value="edge-legacy"
          className="flex-1 m-0 overflow-auto bg-zinc-950"
        >
          <EdgeLogsTab
            projectId={projectId}
            organizationSlug={organizationSlug}
            autoRefresh={autoRefresh}
          />
        </TabsContent>

        <TabsContent
          value="postgres"
          className="flex-1 m-0 overflow-auto bg-zinc-950"
        >
          <ProjectLogsTab
            projectId={projectId}
            organizationSlug={organizationSlug}
            source="postgres"
            autoRefresh={autoRefresh}
            emptyLabel="PostgreSQL logs will appear here. These include query execution, errors, and performance warnings."
          />
        </TabsContent>

        <TabsContent
          value="auth"
          className="flex-1 m-0 overflow-auto bg-zinc-950"
        >
          <ProjectLogsTab
            projectId={projectId}
            organizationSlug={organizationSlug}
            source="auth"
            autoRefresh={autoRefresh}
            emptyLabel="Authentication logs will appear here. These include sign-ins, sign-ups, and token operations."
          />
        </TabsContent>

        <TabsContent
          value="postgrest"
          className="flex-1 m-0 overflow-auto bg-zinc-950"
        >
          <ProjectLogsTab
            projectId={projectId}
            organizationSlug={organizationSlug}
            source="postgrest"
            autoRefresh={autoRefresh}
            emptyLabel="API (PostgREST) logs will appear here. These include REST API requests and responses."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
