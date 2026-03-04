import { useTranslation } from "react-i18next";
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

interface MemoryPressureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  data?: {
    systemMemoryUsageMB: number;
    systemMemoryTotalMB: number;
    usagePercent: number;
    processMemoryMB: number;
  };
}

export function MemoryPressureDialog({
  isOpen,
  onClose,
  data,
}: MemoryPressureDialogProps) {
  const { t } = useTranslation(["home", "common"]);

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <AlertDialogTitle>{t("home:memoryPressureTitle")}</AlertDialogTitle>
          </div>
          <AlertDialogDescription render={<div />}>
            <div className="space-y-4 pt-2 text-muted-foreground">
              <div className="text-base">
                {t("home:memoryPressureDescription", {
                  usagePercent: data?.usagePercent ?? 0,
                })}
              </div>

              {data && (
                <div className="rounded-lg border bg-muted/50 p-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("home:systemMetrics")}
                    </span>
                    <span className="font-mono">
                      {data.systemMemoryUsageMB} / {data.systemMemoryTotalMB} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Dyad {t("home:memory")}
                    </span>
                    <span className="font-mono">{data.processMemoryMB} MB</span>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>
            {t("common:ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
