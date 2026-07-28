import { ChevronRight } from "lucide-react";

/**
 * The recorded flow, as the list of Playwright statements it will replay.
 *
 * Shown once recording stops, before anything is written: this list IS the
 * recording at that point, and it is numbered exactly the way the assertion
 * pass numbers it, so a user reading "step 3" here and the agent describing
 * step 3 are looking at the same line.
 *
 * Deliberately quiet — it's context for the decision in the bar above it
 * ("generate assertions?"), not the decision itself.
 */
export function RecordedStepsList({ steps }: { steps: string[] }) {
  if (steps.length === 0) {
    return (
      <div
        className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground italic"
        data-testid="preview-recorded-steps"
      >
        Nothing was recorded — the test would only open the app.
      </div>
    );
  }

  return (
    <ol
      className="max-h-40 overflow-y-auto border-t border-border/60 px-3 py-1.5"
      data-testid="preview-recorded-steps"
    >
      {steps.map((step, index) => (
        <li
          key={`${index}-${step}`}
          data-testid={`preview-recorded-step-${index}`}
          className="flex items-center gap-1.5 py-0.5 font-mono text-xs"
        >
          <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <ChevronRight
            size={11}
            className="shrink-0 text-purple-500/70 dark:text-purple-400/70"
          />
          <span className="truncate">{step}</span>
        </li>
      ))}
    </ol>
  );
}
