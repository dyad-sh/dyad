import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { highlightPlaywrightLine } from "./playwrightHighlight";

/**
 * Inline Playwright statement generated for the step the user just performed.
 * It takes the flexible middle of the recording status row, keeping the live
 * feedback beside the recorder controls instead of growing a second bar below.
 *
 * Only the current (latest) step is shown — as each new interaction is recorded
 * the line is replaced and animates in, so the banner always reflects "the code
 * for what you just did" rather than a growing transcript.
 */
export function RecordingCodePreview({
  steps,
  className,
}: {
  /** Playwright statements, one per collapsed step, oldest first. */
  steps: string[];
  className?: string;
}) {
  const stepNumber = steps.length;
  const current = stepNumber > 0 ? steps[stepNumber - 1] : null;

  return (
    <div
      // Each interaction replaces this line rather than appending to a list, so
      // a screen-reader user has no other way to know what the recorder just
      // captured. `status` announces it politely, without stealing focus from
      // the app the user is driving.
      role="status"
      className={cn("flex min-w-0 items-center", className)}
      data-testid="preview-recording-code"
    >
      <span className="sr-only">Latest generated test code:</span>

      {current ? (
        <code
          key={stepNumber}
          data-testid="preview-recording-code-line"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-(--background-lightest) px-2.5 py-1 font-mono text-xs animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
        >
          <ChevronRight
            size={12}
            className="shrink-0 text-purple-500/70 dark:text-purple-400/70"
          />
          <span className="truncate">{highlightPlaywrightLine(current)}</span>
        </code>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground italic">
          Interact with your app — the generated test code shows up here.
        </span>
      )}
    </div>
  );
}
