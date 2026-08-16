import { ipc } from "@/ipc/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon, Camera, MessageSquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { ScreenshotSuccessDialog } from "./ScreenshotSuccessDialog";
import { type ScreenshotOutcome } from "@/lib/issueBody";

/** Which report flow opened the prompt. Reported with every prompt event. */
export type ScreenshotPromptSource = "report-bug" | "upload-session";

/**
 * Everything that differs between the two flows, keyed by the same value the
 * events are tagged with. Keeping it here rather than in props means the copy
 * cannot drift out of sync with the source it describes.
 */
const VARIANTS = {
  "report-bug": {
    declineLabel: "File bug report without screenshot",
    pendingLabel: "Preparing Report...",
    declineIcon: <BugIcon className="mr-2 h-5 w-5" />,
  },
  "upload-session": {
    declineLabel: "Create issue without screenshot",
    pendingLabel: "Creating Issue...",
    declineIcon: <MessageSquareIcon className="mr-2 h-5 w-5" />,
  },
} as const;

interface BugScreenshotDialogProps {
  isOpen: boolean;
  /** Hides the prompt without ending the flow, so it stays out of the capture. */
  onClose: () => void;
  /** The reporter backed out of the prompt without filing anything. */
  onDismiss: () => void;
  /** Files the report, recording what happened with the screenshot. */
  onContinue: (outcome: ScreenshotOutcome) => void | Promise<void>;
  isLoading: boolean;
  source: ScreenshotPromptSource;
}

export function BugScreenshotDialog({
  isOpen,
  onClose,
  onDismiss,
  onContinue,
  isLoading,
  source,
}: BugScreenshotDialogProps) {
  const { declineLabel, pendingLabel, declineIcon } = VARIANTS[source];
  const [isScreenshotSuccessOpen, setIsScreenshotSuccessOpen] = useState(false);
  const posthog = usePostHog();

  useEffect(() => {
    if (!isOpen) return;
    posthog.capture("screenshot-prompt:shown", { source });
  }, [isOpen, source, posthog]);

  const handleCapture = () => {
    posthog.capture("screenshot-prompt:capture", { source });
    onClose();
    setTimeout(async () => {
      try {
        await ipc.system.takeScreenshot();
        setIsScreenshotSuccessOpen(true);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Failed to take screenshot";
        posthog.capture("screenshot-prompt:capture-failed", { source, reason });
        // Carry on to the issue. The reporter came here to file one, and the
        // status line records why no screenshot is attached.
        onContinue({ status: "capture-failed", reason });
      }
    }, 200); // Small delay for dialog to close
  };

  const handleDecline = async () => {
    posthog.capture("screenshot-prompt:decline", { source });
    // Stay open, showing the pending label, until the issue is ready. Closing
    // first leaves the reporter with no feedback while logs are gathered.
    await onContinue({ status: "declined" });
    onClose();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onDismiss}>
        {/* While the report is being prepared the prompt has no working exit,
            so don't offer one: onDismiss ignores dismissals until it lands. */}
        <DialogContent showCloseButton={!isLoading}>
          <DialogHeader>
            <DialogTitle>Take a screenshot?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col space-y-4 w-full">
            <div className="flex flex-col space-y-2">
              <Button
                variant="default"
                onClick={handleCapture}
                disabled={isLoading}
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
                onClick={handleDecline}
                disabled={isLoading}
                className="w-full py-6 bg-(--background-lightest)"
              >
                {declineIcon} {isLoading ? pendingLabel : declineLabel}
              </Button>
              <p className="text-sm text-muted-foreground px-2">
                We'll still try to respond but might not be able to help as
                much.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ScreenshotSuccessDialog
        isOpen={isScreenshotSuccessOpen}
        onDismiss={() => {
          // Matches the prompt: a report already on its way cannot be called
          // off, so don't let this close either and leave nothing on screen.
          if (isLoading) return;
          setIsScreenshotSuccessOpen(false);
          onDismiss();
        }}
        onSubmit={async () => {
          await onContinue({ status: "captured" });
          setIsScreenshotSuccessOpen(false);
        }}
        isLoading={isLoading}
        pendingLabel={pendingLabel}
      />
    </>
  );
}
