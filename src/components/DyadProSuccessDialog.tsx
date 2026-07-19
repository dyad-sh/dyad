import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Bot, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DyadProSuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DyadProSuccessDialog({
  isOpen,
  onClose,
}: DyadProSuccessDialogProps) {
  const { t } = useTranslation("home");
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span>{t("proSuccess.welcome")}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p className="text-base text-muted-foreground">
            {t("proSuccess.description")}
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
                <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="font-medium">{t("proSuccess.autoModel")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("proSuccess.autoModelDescription")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/50">
                <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="font-medium">{t("proSuccess.agentMode")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("proSuccess.agentModeDescription")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full">
            {t("proSuccess.getStarted")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
