import { DialogTitle } from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogHeader } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon } from "lucide-react";

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
  const handleSubmit = async () => {
    await handleReportBug();
    onClose();
  };
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Screenshot captured to clipboard! Please paste in GitHub issue.
          </DialogTitle>
        </DialogHeader>
        <Button
          variant="default"
          onClick={handleSubmit}
          className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
        >
          <BugIcon className="mr-2 h-5 w-5" />{" "}
          {isLoading ? "Preparing Report..." : "Create GitHub issue"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
