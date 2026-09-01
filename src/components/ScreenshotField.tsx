import { Button } from "@/components/ui/button";
import { Camera, Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import { type ScreenshotOutcome } from "@/lib/issueBody";

interface ScreenshotFieldProps {
  outcome: ScreenshotOutcome | null;
  /** Data URL of the capture, shown large enough to read before it is sent. */
  previewSrc: string | null;
  isCapturing: boolean;
  onCapture: () => void;
  onRemove: () => void;
}

export function ScreenshotField({
  outcome,
  previewSrc,
  isCapturing,
  onCapture,
  onRemove,
}: ScreenshotFieldProps) {
  if (previewSrc) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Screenshot</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCapture}
              disabled={isCapturing}
            >
              <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" /> Retake
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <XIcon className="mr-1.5 h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        </div>
        {/* Large enough to read: this is the reporter's only chance to see
            what they are about to make public. */}
        <img
          src={previewSrc}
          alt="Screenshot attached to this report"
          className="w-full max-h-72 object-contain rounded-md border bg-(--background-lightest)"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onCapture}
        disabled={isCapturing}
        className="w-full rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-colors px-4 py-5 flex items-center gap-3 text-left disabled:opacity-60"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          {isCapturing ? (
            <Loader2Icon className="h-5 w-5 animate-spin" />
          ) : (
            <Camera className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {isCapturing ? "Taking screenshot..." : "Add a screenshot"}
          </span>
          <span className="block text-xs text-muted-foreground">
            Dyad hides while it captures. You will see it before it is sent.
          </span>
        </span>
      </button>
      {outcome?.status === "capture-failed" && (
        <p className="text-xs text-destructive" role="alert">
          {outcome.reason ?? "Could not take a screenshot."} You can still send
          the report without one.
        </p>
      )}
    </div>
  );
}
