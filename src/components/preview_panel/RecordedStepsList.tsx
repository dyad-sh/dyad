import { highlightPlaywrightLine } from "./playwrightHighlight";

/**
 * The recorded flow, as the list of Playwright statements it will replay.
 *
 * Shown once recording stops, before anything is written: this list IS the
 * recording at that point, in the order and at the granularity the spec will
 * replay it.
 *
 * Numbered from 1, matching the assertion card's "Add a check after step N".
 * The prompt and `generate_test_assertions` count the same statements from 0 —
 * that numbering is internal to the tool call and never shown, and
 * `buildAssertionsPrompt` tells the model about this offset so a user asking
 * for a check "after step 3" and the model agree on which line that is.
 *
 * Deliberately quiet — it's context for the decision in the bar above it
 * ("generate a test proposal?"), not the decision itself. It renders flush on the
 * recording banner's own surface: the banner draws the hairline above it, so
 * this is a section of that banner rather than a second one.
 *
 * Statements wrap rather than truncate. What identifies a step is the button
 * label or field name at the *end* of the locator, so an ellipsis cut the one
 * part that told two steps apart — a column of `await page.getByRole("button",
 * { name: "…` reads as the same step four times. Wrapped lines hang under their
 * number so the start of each step stays findable.
 */
export function RecordedStepsList({ steps }: { steps: string[] }) {
  if (steps.length === 0) {
    return (
      <div
        className="px-3 py-2 text-xs text-muted-foreground italic"
        data-testid="preview-recorded-steps"
      >
        Nothing was recorded — the test would only open the app.
      </div>
    );
  }

  return (
    <ol
      // Focusable so the steps past the fold are reachable without a mouse: the
      // list is capped and scrolls, and nothing inside it takes focus on its own.
      tabIndex={0}
      aria-label="Recorded steps"
      className="max-h-44 overflow-y-auto overscroll-contain px-3 py-1.5 focus-visible:ring-2 focus-visible:ring-purple-500/40 focus-visible:outline-none focus-visible:ring-inset"
      data-testid="preview-recorded-steps"
    >
      {steps.map((step, index) => (
        <li
          key={`${index}-${step}`}
          data-testid={`preview-recorded-step-${index}`}
          // No vertical padding: `leading-5` already opens 4px above and below
          // each line, which separates rows AND the wrapped lines within one row.
          // Padding on top of that costs a visible step per screenful.
          className="flex items-start gap-2 font-mono text-xs leading-5"
        >
          <span className="w-5 shrink-0 text-right text-[10px] leading-5 text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 pl-5 -indent-5 break-words">
            {highlightPlaywrightLine(step)}
          </span>
        </li>
      ))}
    </ol>
  );
}
