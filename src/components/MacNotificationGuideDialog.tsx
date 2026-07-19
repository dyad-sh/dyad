import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface MacNotificationGuideDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MacNotificationGuideDialog({
  open,
  onClose,
}: MacNotificationGuideDialogProps) {
  const { t } = useTranslation("common");
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("common:notifications.title")}</DialogTitle>
          <DialogDescription>
            {t("common:notifications.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-3 space-y-1">
            <h4 className="text-sm font-medium">
              {t("common:notifications.option1")}
            </h4>
            <p className="text-sm text-muted-foreground">
              {t("common:notifications.permissionPrompt")}
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-1">
            <h4 className="text-sm font-medium">
              {t("common:notifications.option2")}
            </h4>
            <p className="text-sm text-muted-foreground">
              {t("common:notifications.systemSettings")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("common:notifications.gotIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
