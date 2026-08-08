/**
 * How fast streamed text is revealed.
 *
 * Text that appears at a perfectly constant rate reads as a machine printing;
 * text that pauses where a reader would pause reads as someone talking. The
 * pacing here follows punctuation rather than the clock: a beat after a
 * sentence, a longer one between paragraphs, and a quick run through material
 * that is scanned rather than read — lists and code.
 */

/** Bounds, so a pathological chunk can never stall or strobe the reveal. */
const MIN_DELAY_MS = 12;
const MAX_DELAY_MS = 90;

export type PaceInput = {
  /** Characters revealed since the previous tick. */
  growth: number;
  /** Text revealed so far; its tail decides where we are in the sentence. */
  revealed: string;
  /** Deterministic jitter source, injectable so tests are not flaky. */
  random?: () => number;
};

/**
 * The delay before the next reveal.
 *
 * A fast-arriving stream shortens the interval so the display keeps up rather
 * than falling behind the model.
 */
export function nextFlushDelay({
  growth,
  revealed,
  random = Math.random,
}: PaceInput): number {
  // Falling behind: catch up instead of pacing prettily.
  let delay = growth > 160 ? 16 : growth > 60 ? 24 : 34;

  const tail = revealed.slice(-24);

  // Scanned material moves quickly: code, list items, table rows.
  if (isScannedContext(tail)) {
    delay *= 0.55;
  }

  // A beat where a reader would take one.
  if (/\n\s*\n\s*$/.test(tail)) {
    delay += 90; // paragraph break
  } else if (/[.!?]["')\]]?\s*$/.test(tail)) {
    delay += 45; // end of a sentence
  } else if (/[,;:—–]\s*$/.test(tail)) {
    delay += 18; // clause break
  }

  // Never perfectly constant: ±15% keeps it from sounding mechanical.
  const jitter = 0.85 + random() * 0.3;
  return clamp(Math.round(delay * jitter));
}

/** Inside a code fence, a list, or a table — material that is scanned. */
function isScannedContext(tail: string): boolean {
  const line = tail.slice(tail.lastIndexOf("\n") + 1);
  return (
    /^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line) ||
    /^\s*\|/.test(line) ||
    /^\s{4,}\S/.test(line) ||
    tail.includes("```")
  );
}

function clamp(value: number): number {
  return Math.min(MAX_DELAY_MS + 100, Math.max(MIN_DELAY_MS, value));
}
