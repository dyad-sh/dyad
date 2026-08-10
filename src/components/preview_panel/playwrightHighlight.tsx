import type { ReactNode } from "react";

/**
 * Lightweight syntax coloring for a single Playwright statement: `await` reads
 * as a keyword, `page` as a subject, and quoted arguments as strings. Purely
 * cosmetic — it never changes the text, so the line still matches the spec.
 *
 * Shared by the recorder's live code strip and its review list so the same
 * statement is never coloured one way while recording and another way while the
 * user is deciding whether to keep it. The quoted arguments carry the colour
 * that matters: they hold the button label or field name, which is the only
 * part that tells two otherwise identical `getByRole(...).click()` steps apart.
 */
export function highlightPlaywrightLine(line: string): ReactNode[] {
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
