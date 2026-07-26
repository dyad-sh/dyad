import type { ReactNode } from "react";
import { ChevronRight, Code2 } from "lucide-react";

/**
 * Live code strip that shows the Playwright statement generated for the step
 * the user just performed. It renders as the second row *inside* the recording
 * banner — a hairline divider, no background of its own — so the status row and
 * the code read as one cohesive surface rather than two stacked banners.
 *
 * Only the current (latest) step is shown — as each new interaction is recorded
 * the line is replaced and animates in, so the banner always reflects "the code
 * for what you just did" rather than a growing transcript.
 */
export function RecordingCodePreview({
  steps,
}: {
  /** Playwright statements, one per collapsed step, oldest first. */
  steps: string[];
}) {
  const stepNumber = steps.length;
  const current = stepNumber > 0 ? steps[stepNumber - 1] : null;

  return (
    <div
      className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5"
      data-testid="preview-recording-code"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-purple-700 uppercase dark:text-purple-300">
        <Code2 className="size-3.5" />
        {current ? `Step ${stepNumber}` : "Live code"}
      </span>

      {current ? (
        <code
          key={stepNumber}
          data-testid="preview-recording-code-line"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-(--background-lightest) px-2.5 py-1 font-mono text-xs shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-200"
        >
          <ChevronRight
            size={12}
            className="shrink-0 text-purple-500/70 dark:text-purple-400/70"
          />
          <span className="truncate">{highlightPlaywrightLine(current)}</span>
        </code>
      ) : (
        <span className="truncate text-xs text-muted-foreground italic">
          Interact with your app — the generated test code shows up here.
        </span>
      )}
    </div>
  );
}

/**
 * Lightweight syntax coloring for a single Playwright statement: `await` reads
 * as a keyword, `page` as a subject, and quoted arguments as strings. Purely
 * cosmetic — it never changes the text, so the line still matches the spec.
 */
function highlightPlaywrightLine(line: string): ReactNode[] {
  // Split on string literals first so quotes inside them are never re-tokenized.
  const segments = line.split(/("(?:[^"\\]|\\.)*")/g);
  return segments.map((segment, i) => {
    if (segment.startsWith('"')) {
      return (
        <span key={i} className="text-emerald-600 dark:text-emerald-400">
          {segment}
        </span>
      );
    }
    return (
      <span key={i}>
        {segment.split(/(\bawait\b|\bpage\b)/g).map((token, j) => {
          if (token === "await") {
            return (
              <span key={j} className="text-purple-600 dark:text-purple-400">
                {token}
              </span>
            );
          }
          if (token === "page") {
            return (
              <span key={j} className="text-sky-600 dark:text-sky-400">
                {token}
              </span>
            );
          }
          return <span key={j}>{token}</span>;
        })}
      </span>
    );
  });
}
