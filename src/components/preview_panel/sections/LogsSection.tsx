import { useState } from "react";
import { FileText, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useEdgeLogs } from "@/hooks/useEdgeLogs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LogsSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

export function LogsSection({ projectId, organizationSlug }: LogsSectionProps) {
  const [autoRefresh, setAutoRefresh] = useState(false);

  const {
    data: logs,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useEdgeLogs({
    projectId,
    organizationSlug,
    enabled: true,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
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

  const logEntries = logs ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <h3 className="text-sm font-medium">Edge Function Logs</h3>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 text-xs"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-zinc-950">
        {logEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <FileText className="w-12 h-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-medium mb-2">No Logs Yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Edge Function logs will appear here when your functions are
                invoked. Deploy and call an Edge Function to see logs.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-2 font-mono text-xs space-y-0.5">
            {logEntries.map((log, index) => (
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
        )}
      </div>
    </div>
  );
}
