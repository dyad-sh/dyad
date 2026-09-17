import { useId, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Read by the sidebar's height and by `.h-screenish`, so that both end above
 * the bar instead of being covered by it. The native preview composites above
 * all renderer DOM, so simply painting the bar over the window would leave it
 * hidden under the preview; shrinking the layout is what keeps it visible.
 */
const HEIGHT_VAR = "--layout-bottom-bar-height";

interface ScreenshotCaptureBarProps {
  onCapture: () => void;
  onCancel: () => void;
}

/**
 * Shown while a report is waiting for its screenshot and the dialog is out of
 * the way, so the reporter can go to wherever the bug is before capturing.
 * Spans the whole window, sidebar included, and pushes the rest of the app up
 * by its own height for as long as it is up.
 */
export function ScreenshotCaptureBar({
  onCapture,
  onCancel,
}: ScreenshotCaptureBarProps) {
  const { t } = useTranslation("home");
  const root = useRef<HTMLDivElement>(null);
  const instructionsId = useId();

  // Before paint, so the layout never spends a frame under the bar. Measured
  // rather than fixed: the copy wraps on a narrow window.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const style = document.documentElement.style;
    const publish = () =>
      style.setProperty(HEIGHT_VAR, `${element.offsetHeight}px`);
    publish();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      style.removeProperty(HEIGHT_VAR);
    };
  }, []);

  return (
    <div
      ref={root}
      role="region"
      aria-label={t("report.captureBarLabel")}
      data-testid="screenshot-capture-bar"
      // Only while focus is inside the bar, so it cannot swallow an Escape
      // meant for something else on the page. Stopped here for the same
      // reason in reverse: the fullscreen code view and others listen for
      // Escape on the window, and this one is not meant for them.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      // Above the app's z-50 layer, so the bar stays reachable over the
      // fullscreen code view and the image lightbox. Modal dialogs still
      // close on the press, since it lands outside them.
      className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 border-t-2 border-primary/70 bg-(--background-lightest) px-4 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Camera className="h-4 w-4" />
      </span>
      <p id={instructionsId} className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{t("report.captureBarHeading")}</span>{" "}
        <span className="text-muted-foreground">
          {t("report.captureBarHint")}
        </span>
      </p>
      <div className="flex shrink-0 gap-1.5">
        {/* The dialog this bar replaces took keyboard focus with it, and the
            bar is last in tab order, so focus starts on the way forward. The
            instructions are described to it, so a screen reader hears why
            the dialog went and what to do next, not just a button name. */}
        <Button
          variant="default"
          size="sm"
          onClick={onCapture}
          autoFocus
          aria-describedby={instructionsId}
        >
          <Camera className="mr-1.5 h-3.5 w-3.5" />
          {t("report.captureBarCapture")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <XIcon className="mr-1.5 h-3.5 w-3.5" />
          {t("report.captureBarCancel")}
        </Button>
      </div>
    </div>
  );
}
