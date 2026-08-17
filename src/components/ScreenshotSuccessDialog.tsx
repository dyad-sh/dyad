import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon } from "lucide-react";

interface ScreenshotSuccessDialogProps {
  isOpen: boolean;
  /** The reporter backed out without filing anything. */
  onDismiss: () => void;
  onSubmit: () => void | Promise<void>;
  isLoading: boolean;
  pendingLabel: string;
}

export function ScreenshotSuccessDialog({
  isOpen,
  onDismiss,
  onSubmit,
  isLoading,
  pendingLabel,
}: ScreenshotSuccessDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onDismiss}>
      <DialogContent showCloseButton={!isLoading}>
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {isLoading ? pendingLabel : ""}
        </span>
        <DialogHeader>
          <DialogTitle>
            Screenshot captured to clipboard! Please paste in GitHub issue.
          </DialogTitle>
        </DialogHeader>
        <Button
          variant="default"
          onClick={() => onSubmit()}
          disabled={isLoading}
          className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
        >
          <BugIcon className="mr-2 h-5 w-5" />{" "}
          {isLoading ? pendingLabel : "Create GitHub issue"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
