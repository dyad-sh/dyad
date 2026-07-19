import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScreenshotSuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  handleReportBug: () => Promise<void>;
  isLoading: boolean;
}

export function ScreenshotSuccessDialog({
  isOpen,
  onClose,
  handleReportBug,
  isLoading,
}: ScreenshotSuccessDialogProps) {
  const { t } = useTranslation("home");
  const handleSubmit = async () => {
    await handleReportBug();
    onClose();
  };
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("screenshot.capturedToClipboard")}</DialogTitle>
        </DialogHeader>
        <Button
          variant="default"
          onClick={handleSubmit}
          className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
        >
          <BugIcon className="mr-2 h-5 w-5" />{" "}
          {isLoading
            ? t("help.preparingReport")
            : t("screenshot.createGithubIssue")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
