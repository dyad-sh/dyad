import { IpcClient } from "@/ipc/ipc_client";
import { Dialog, DialogTitle } from "@radix-ui/react-dialog";
import { DialogContent, DialogHeader } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon, Camera } from "lucide-react";
import { useState } from "react";
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
  const [isScreenshotSuccessOpen, setIsScreenshotSuccessOpen] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const handleReportBugWithScreenshot = async () => {
    setScreenshotError(null);
    onClose();
    setTimeout(async () => {
      try {
        await IpcClient.getInstance().takeScreenshot();
        setIsScreenshotSuccessOpen(true);
      } catch (error) {
        setScreenshotError(
          error instanceof Error ? error.message : "Failed to take screenshot",
        );
      }
    }, 200); // Small delay for dialog to close
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take a screenshot?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col space-y-4 w-full">
          <div className="flex flex-col space-y-2">
            <Button
              variant="default"
              onClick={handleReportBugWithScreenshot}
              className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
            >
              <Camera className="mr-2 h-5 w-5" /> Take a screenshot
              (recommended)
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              You'll get better and faster responses if you do this!
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
                ? "Preparing Report..."
                : "File bug report without screenshot"}
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              We'll still try to respond but might not be able to help as much.
            </p>
          </div>
          {screenshotError && (
            <p className="text-sm text-destructive px-2">
              Failed to take screenshot: {screenshotError}
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
