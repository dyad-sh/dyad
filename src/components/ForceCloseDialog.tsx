import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetAtom } from "jotai";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Upload } from "lucide-react";
import { ipc } from "@/ipc/types";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { formatDate } from "@/i18n/format";

interface ForceClosePerformanceData {
  timestamp: number;
  memoryUsageMB: number;
  cpuUsagePercent?: number;
  systemMemoryUsageMB?: number;
  systemMemoryTotalMB?: number;
  systemCpuPercent?: number;
}

// Self-contained: subscribes to the force-close event and owns its open state.
// Mounted in the root layout so it appears regardless of the current route,
// e.g. when the app restores a chat on startup.
export function ForceCloseDialog() {
  const { t, i18n } = useTranslation(["home", "common"]);
  const setHelpDialog = useSetAtom(helpDialogAtom);
  const [isOpen, setIsOpen] = useState(false);
  const [performanceData, setPerformanceData] = useState<
    ForceClosePerformanceData | undefined
  >(undefined);
  // The chat that was streaming at crash time (from the crash sentinel). When
  // present, we offer a one-click upload of that session.
  const [activeChatId, setActiveChatId] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    const unsubscribe = ipc.events.system.onForceCloseDetected((data) => {
      setPerformanceData(data.performanceData);
      setActiveChatId(data.activeChatId);
      setIsOpen(true);
    });
    return () => unsubscribe();
  }, []);

  const onClose = () => setIsOpen(false);

  const handleUploadChatSession = () => {
    if (activeChatId == null) return;
    onClose();
    setHelpDialog({ open: true, uploadChatId: activeChatId });
  };

  const formatTimestamp = (timestamp: number) => {
    return formatDate(new Date(timestamp), i18n.language);
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <AlertDialogTitle>{t("home:forceCloseDetected")}</AlertDialogTitle>
          </div>
          <AlertDialogDescription render={<div />}>
            <div className="space-y-4 pt-2 text-muted-foreground">
              <div className="text-base">{t("home:forceCloseDescription")}</div>

              {!performanceData && (
                <div className="rounded-lg border bg-muted/50 p-4 text-sm">
                  {t("home:noDiagnosticData")}
                </div>
              )}

              {performanceData && (
                <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                  <div className="font-semibold text-sm text-foreground">
                    {t("home:lastKnownState")}{" "}
                    <span className="font-normal text-muted-foreground">
                      {formatTimestamp(performanceData.timestamp)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {/* Process Metrics */}
                    <div className="space-y-2">
                      <div className="font-medium text-foreground">
                        {t("home:processMetrics")}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {t("home:memory")}
                          </span>
                          <span className="font-mono">
                            {performanceData.memoryUsageMB}{" "}
                            {t("common:megabytes")}
                          </span>
                        </div>
                        {performanceData.cpuUsagePercent !== undefined && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              {t("home:cpu")}
                            </span>
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
                          {t("home:systemMetrics")}
                        </div>
                        <div className="space-y-1">
                          {performanceData.systemMemoryUsageMB !== undefined &&
                            performanceData.systemMemoryTotalMB !==
                              undefined && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  {t("home:memory")}
                                </span>
                                <span className="font-mono">
                                  {performanceData.systemMemoryUsageMB} /{" "}
                                  {performanceData.systemMemoryTotalMB}{" "}
                                  {t("common:megabytes")}
                                </span>
                              </div>
                            )}
                          {performanceData.systemCpuPercent !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                {t("home:cpu")}
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
          {activeChatId != null && (
            <Button variant="outline" onClick={handleUploadChatSession}>
              <Upload className="h-4 w-4" />
              {t("home:help.uploadChatSession")}
            </Button>
          )}
          <AlertDialogAction onClick={onClose}>
            {t("common:ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
