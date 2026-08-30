import { ipc } from "@/ipc/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon, Camera, MessageSquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { ScreenshotSuccessDialog } from "./ScreenshotSuccessDialog";
import { showError } from "@/lib/toast";
import { SCREENSHOT_ERRORS } from "@/ipc/types/system";
import { type ReportFields, type ScreenshotOutcome } from "@/lib/issueBody";

/** Which report flow opened the prompt. Reported with every prompt event. */
export type ScreenshotPromptSource = "report-bug" | "upload-session";

/**
 * Shared by the prompt and the form so both report the same `source`, and a
 * change to one cannot silently split the funnel across two spellings.
 */
export function promptSourceForKind(
  kind: "bug" | "session",
): ScreenshotPromptSource {
  return kind === "session" ? "upload-session" : "report-bug";
}

/**
 * The report a prompt was opened for, carried through to the outcome. The
 * form fields ride along rather than being read back from the help dialog:
 * opening the prompt closes that dialog, and the report is dispatched
 * asynchronously after the prompt is answered.
 */
export type PendingReport =
  | { kind: "bug"; fields: ReportFields }
  | { kind: "session"; sessionId: string; fields: ReportFields };

/**
 * Known capture failures, reported instead of the raw message so the event
 * carries a fixed set of values. The raw message still reaches the issue body,
 * which the reporter sees before submitting. Matching on the shared constants
 * keeps this in step with what the handler throws.
 */
function classifyCaptureFailure(reason: string): string {
  if (reason.includes(SCREENSHOT_ERRORS.noFocusedWindow)) {
    return "no-focused-window";
  }
  if (reason.includes(SCREENSHOT_ERRORS.emptyImage)) return "empty-image";
  return "other";
}

/** Copy that differs between the two flows, keyed by the reporting source. */
const VARIANTS = {
  "report-bug": {
    declineLabel: "File bug report without screenshot",
    icon: <BugIcon className="mr-2 h-5 w-5" />,
  },
  "upload-session": {
    declineLabel: "Create issue without screenshot",
    icon: <MessageSquareIcon className="mr-2 h-5 w-5" />,
  },
} as const;

interface BugScreenshotDialogProps {
  isOpen: boolean;
  /** Hides the prompt without ending the flow, so it stays out of the capture. */
  onClose: () => void;
  /** The reporter backed out of the prompt without answering it. */
  onDismiss: () => void;
  /** The reporter closed the captured screenshot without filing a report. */
  onCaptureAbandon: () => void;
  /** Files the report, recording what happened with the screenshot. */
  onContinue: (outcome: ScreenshotOutcome, report: PendingReport) => void;
  source: ScreenshotPromptSource;
  /** The report this prompt was opened for. */
  report: PendingReport | null;
}

export function BugScreenshotDialog({
  isOpen,
  onClose,
  onDismiss,
  onCaptureAbandon,
  onContinue,
  source,
  report,
}: BugScreenshotDialogProps) {
  const { declineLabel, icon } = VARIANTS[source];
  const [capture, setCapture] = useState<{
    report: PendingReport;
    source: ScreenshotPromptSource;
    dataUrl?: string;
  } | null>(null);
  const hasReportedShown = useRef(false);
  // A dialog stays clickable through its closing animation. These keep one
  // answer per opening, so a second click cannot file or report twice.
  const promptAnswered = useRef(false);
  const captureAnswered = useRef(false);
  // Holds the image across the success dialog's closing animation, the same
  // reason `icon` below falls back to the `source` prop: `capture` is nulled
  // the moment the reporter answers, while the dialog is still on screen.
  const lastPreview = useRef<string | undefined>(undefined);
  if (capture?.dataUrl) lastPreview.current = capture.dataUrl;
  const posthog = usePostHog();

  // Latched on the open edge so the count is one per prompt, whatever else
  // changes while it is on screen.
  useEffect(() => {
    if (!isOpen) {
      hasReportedShown.current = false;
      return;
    }
    if (hasReportedShown.current) return;
    hasReportedShown.current = true;
    posthog.capture("screenshot-prompt:shown", { source });
  }, [isOpen, source, posthog]);

  // Kept separate from the event above so a change there cannot disable the
  // guard. Reset on open rather than on close, because the prompt is still
  // clickable while it animates out.
  useEffect(() => {
    if (isOpen) promptAnswered.current = false;
  }, [isOpen]);

  const handleCapture = () => {
    if (promptAnswered.current || !report) return;
    promptAnswered.current = true;
    // Captured per invocation, so a capture that resolves after another has
    // started still files against the report that began it.
    const capturedFor = report;
    // An attempt, not a success: the capture can still fail below.
    posthog.capture("screenshot-prompt:capture-attempt", { source });
    onClose();
    setTimeout(async () => {
      try {
        const { dataUrl } = await ipc.system.takeScreenshot();
        captureAnswered.current = false;
        setCapture({ report: capturedFor, source, dataUrl });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Failed to take screenshot";
        posthog.capture("screenshot-prompt:capture-failed", {
          source,
          failure: classifyCaptureFailure(reason),
        });
        // Prevents the case where the reporter reaches GitHub expecting an
        // image on the clipboard and pastes whatever is there instead.
        // Both known reasons already read as a screenshot failure, so a prefix
        // here only doubles the message.
        showError(reason);
        onContinue({ status: "capture-failed", reason }, capturedFor);
      }
    }, 200); // Small delay for dialog to close
  };

  const handleDecline = () => {
    if (promptAnswered.current || !report) return;
    promptAnswered.current = true;
    posthog.capture("screenshot-prompt:decline", { source });
    onClose();
    onContinue({ status: "declined" }, report);
  };

  const handlePromptDismiss = () => {
    if (promptAnswered.current || !report) return;
    promptAnswered.current = true;
    posthog.capture("screenshot-prompt:dismissed", { source });
    onDismiss();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handlePromptDismiss}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take a screenshot?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col space-y-4 w-full">
            <div className="flex flex-col space-y-2">
              <Button
                variant="default"
                onClick={handleCapture}
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
                className="w-full py-6 bg-(--background-lightest)"
              >
                {icon} {declineLabel}
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
        isOpen={capture !== null}
        onDismiss={() => {
          if (captureAnswered.current || !capture) return;
          captureAnswered.current = true;
          // A screenshot was taken but no report follows it.
          posthog.capture("screenshot-prompt:capture-abandoned", {
            source: capture.source,
          });
          setCapture(null);
          onCaptureAbandon();
        }}
        onSubmit={() => {
          if (captureAnswered.current || !capture) return;
          captureAnswered.current = true;
          posthog.capture("screenshot-prompt:captured", {
            source: capture.source,
          });
          setCapture(null);
          onContinue({ status: "captured" }, capture.report);
        }}
        previewSrc={capture?.dataUrl ?? lastPreview.current}
        icon={VARIANTS[capture?.source ?? source].icon}
      />
    </>
  );
}
