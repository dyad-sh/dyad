import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

interface ForceCloseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  performanceData?: {
    timestamp: number;
    memoryUsageMB: number;
    cpuUsagePercent?: number;
    systemMemoryUsageMB?: number;
    systemMemoryTotalMB?: number;
    systemCpuPercent?: number;
  };
}

export function ForceCloseDialog({
  isOpen,
  onClose,
  performanceData,
}: ForceCloseDialogProps) {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <AlertDialogTitle>Force Close Detected</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              <div className="text-base">
                The app was not closed properly the last time it was running.
                This could indicate a crash or unexpected termination.
              </div>

              {performanceData && (
                <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                  <div className="font-semibold text-sm text-foreground">
                    Last Known State:{" "}
                    <span className="font-normal text-muted-foreground">
                      {formatTimestamp(performanceData.timestamp)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {/* Process Metrics */}
                    <div className="space-y-2">
                      <div className="font-medium text-foreground">
                        Process Metrics
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Memory:</span>
                          <span className="font-mono">
                            {performanceData.memoryUsageMB} MB
                          </span>
                        </div>
                        {performanceData.cpuUsagePercent !== undefined && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">CPU:</span>
                            <span className="font-mono">
                              {performanceData.cpuUsagePercent}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* System Metrics */}
                    {(performanceData.systemMemoryUsageMB !== undefined ||
                      performanceData.systemCpuPercent !== undefined) && (
                      <div className="space-y-2">
                        <div className="font-medium text-foreground">
                          System Metrics
                        </div>
                        <div className="space-y-1">
                          {performanceData.systemMemoryUsageMB !== undefined &&
                            performanceData.systemMemoryTotalMB !==
                              undefined && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Memory:
                                </span>
                                <span className="font-mono">
                                  {performanceData.systemMemoryUsageMB} /{" "}
                                  {performanceData.systemMemoryTotalMB} MB
                                </span>
                              </div>
                            )}
                          {performanceData.systemCpuPercent !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                CPU:
                              </span>
                              <span className="font-mono">
                                {performanceData.systemCpuPercent}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
