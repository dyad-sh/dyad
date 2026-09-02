import { Button } from "@/components/ui/button";
import { Camera, Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import { type ScreenshotOutcome } from "@/lib/issueBody";
import { useTranslation } from "react-i18next";

interface ScreenshotFieldProps {
  outcome: ScreenshotOutcome | null;
  /** Data URL of the capture, shown large enough to read before it is sent. */
  previewSrc: string | null;
  isCapturing: boolean;
  /** Locked once filing starts: the screenshot has already been acted on. */
  locked: boolean;
  onCapture: () => void;
  onRemove: () => void;
}

export function ScreenshotField({
  outcome,
  previewSrc,
  isCapturing,
  locked,
  onCapture,
  onRemove,
}: ScreenshotFieldProps) {
  const { t } = useTranslation(["home", "common"]);
  if (previewSrc) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {t("home:report.screenshot")}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCapture}
              disabled={isCapturing || locked}
            >
              <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />{" "}
              {t("home:report.retake")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={locked}
            >
              <XIcon className="mr-1.5 h-3.5 w-3.5" /> {t("home:report.remove")}
            </Button>
          </div>
        </div>
        {/* Large enough to read: this is the reporter's only chance to see
            what they are about to make public. */}
        <img
          src={previewSrc}
          alt={t("home:report.screenshotAlt")}
          className="w-full max-h-72 object-contain rounded-md border bg-(--background-lightest)"
        />
        {/* The image travels on the clipboard, not in the report, so the
            reporter has to paste it once GitHub opens. */}
        <p className="text-xs text-muted-foreground">
          {/* Split on the placeholder so the keys keep their <kbd> styling
              without breaking the sentence into fragments, which would put
              them in the wrong place in languages that reorder the verb. */}
          {(() => {
            const parts = t("home:report.screenshotPasteHint", {
              shortcut: "\u0000",
            }).split("\u0000");
            // A translation that drops or repeats the placeholder still
            // renders one readable sentence with one set of keys.
            const before = parts[0];
            const after = parts.slice(1).join("");
            return (
              <>
                {before}
                <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>V</kbd>
                {after}
              </>
            );
          })()}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onCapture}
        disabled={isCapturing || locked}
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
            {isCapturing
              ? t("home:report.takingScreenshot")
              : t("home:report.addScreenshot")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("home:report.screenshotHint")}
          </span>
        </span>
      </button>
      {outcome?.status === "capture-failed" && (
        <div role="alert" className="flex flex-col gap-0.5">
          <p className="text-xs text-destructive">
            {t("home:report.screenshotFailed")}{" "}
            {t("home:report.screenshotStillFile")}
          </p>
          {/* The reason comes from the OS and is not translated, so it sits on
              its own rather than being read as part of the sentence above. */}
          {outcome.reason && (
            <p className="text-xs text-muted-foreground">{outcome.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
