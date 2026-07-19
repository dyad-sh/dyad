import { ipc } from "@/ipc/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon, Camera } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScreenshotSuccessDialog } from "./ScreenshotSuccessDialog";

interface BugScreenshotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  handleReportBug: () => Promise<void>;
  isLoading: boolean;
}
export function BugScreenshotDialog({
  isOpen,
  onClose,
  handleReportBug,
  isLoading,
}: BugScreenshotDialogProps) {
  const { t } = useTranslation(["home", "common"]);
  const [isScreenshotSuccessOpen, setIsScreenshotSuccessOpen] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const handleReportBugWithScreenshot = async () => {
    setScreenshotError(null);
    onClose();
    setTimeout(async () => {
      try {
        await ipc.system.takeScreenshot();
        setIsScreenshotSuccessOpen(true);
      } catch (error) {
        setScreenshotError(
          error instanceof Error ? error.message : t("common:unknownError"),
        );
      }
    }, 200); // Small delay for dialog to close
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("home:screenshot.takeScreenshot")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col space-y-4 w-full">
          <div className="flex flex-col space-y-2">
            <Button
              variant="default"
              onClick={handleReportBugWithScreenshot}
              className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
            >
              <Camera className="mr-2 h-5 w-5" />
              {t("home:screenshot.takeScreenshotRecommended")}
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              {t("home:screenshot.betterResponses")}
            </p>
          </div>
          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                handleReportBug();
              }}
              className="w-full py-6 bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-5 w-5" />{" "}
              {isLoading
                ? t("home:help.preparingReport")
                : t("home:screenshot.fileWithoutScreenshot")}
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              {t("home:screenshot.mightNotHelp")}
            </p>
          </div>
          {screenshotError && (
            <p className="text-sm text-destructive px-2">
              {t("home:screenshot.failedScreenshot", {
                error: screenshotError,
              })}
            </p>
          )}
        </div>
      </DialogContent>
      <ScreenshotSuccessDialog
        isOpen={isScreenshotSuccessOpen}
        onClose={() => setIsScreenshotSuccessOpen(false)}
        handleReportBug={handleReportBug}
        isLoading={isLoading}
      />
    </Dialog>
  );
}
