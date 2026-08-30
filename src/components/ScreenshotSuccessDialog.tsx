import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { type ReactNode } from "react";

interface ScreenshotSuccessDialogProps {
  isOpen: boolean;
  /** The reporter backed out without filing anything. */
  onDismiss: () => void;
  onSubmit: () => void;
  icon: ReactNode;
  /** Data URL of the capture, so the reporter can see what they are sending. */
  previewSrc?: string;
}

export function ScreenshotSuccessDialog({
  isOpen,
  onDismiss,
  onSubmit,
  icon,
  previewSrc,
}: ScreenshotSuccessDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onDismiss}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Screenshot captured to clipboard! Please paste in GitHub issue.
          </DialogTitle>
        </DialogHeader>
        {previewSrc && (
          <img
            src={previewSrc}
            alt="Screenshot that was copied to your clipboard"
            className="w-full max-h-64 object-contain rounded-md border bg-(--background-lightest)"
          />
        )}
        <Button
          variant="default"
          onClick={onSubmit}
          className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
        >
          {icon} Create GitHub issue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
