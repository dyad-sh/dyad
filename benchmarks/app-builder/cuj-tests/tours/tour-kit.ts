// Shared helpers for the video "tour" specs.
//
// A tour is a single tolerant walkthrough of one generated app, recorded as
// one continuous video. Unlike the scoring suites, a tour NEVER fails: every
// step is try/caught so a missing or broken feature is shown on camera rather
// than ending the recording. Nothing here is used by scoring.
import type { Page } from "@playwright/test";

export const RUN_ID = `${Date.now()}`;

const CAPTION_ID = "__tour_caption__";

/** Draw (or redraw) the fixed step banner at the top of the viewport. */
export async function caption(page: Page, text: string): Promise<void> {
  await page
    .evaluate(
      ({ id, label }) => {
        document.getElementById(id)?.remove();
        const el = document.createElement("div");
        el.id = id;
        el.textContent = label;
        el.setAttribute(
          "style",
          [
            "position:fixed",
            "top:0",
            "left:0",
            "right:0",
            "z-index:2147483647",
            "background:rgba(15,23,42,0.9)",
            "color:#f8fafc",
            "font:600 20px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif",
            "padding:10px 18px",
            "letter-spacing:0.01em",
            "pointer-events:none",
            "box-shadow:0 2px 14px rgba(0,0,0,0.35)",
          ].join(";"),
        );
        document.body.appendChild(el);
      },
      { id: CAPTION_ID, label: text },
    )
    .catch(() => undefined);
}

export interface Tour {
  /** Caption, run, and never throw. Failures are logged and collected. */
  step(label: string, fn: () => Promise<void>): Promise<void>;
  readonly failures: string[];
}

export function startTour(page: Page, total: number): Tour {
  let index = 0;
  let current = "";
  const failures: string[] = [];

  // Navigation wipes the banner, so redraw it whenever a document loads.
  page.on("load", () => {
    if (current) void caption(page, current);
  });

  return {
    failures,
    async step(label, fn) {
      index += 1;
      current = `${index}/${total} · ${label}`;
      await caption(page, current);
      await page.waitForTimeout(700);
      try {
        await fn();
        console.log(`  PASS  ${current}`);
      } catch (error) {
        const message = String((error as Error)?.message ?? error).split(
          "\n",
        )[0];
        failures.push(`${current} — ${message}`);
        console.log(`  FAIL  ${current} — ${message}`);
      }
      // Re-draw after the step in case it navigated, then let it settle.
      await caption(page, current);
      await page.waitForTimeout(400);
    },
  };
}

/** Log the tour outcome; a tour never fails the test run. */
export function reportTour(app: string, tour: Tour, total: number): void {
  const passed = total - tour.failures.length;
  console.log(`\n[tour:${app}] ${passed}/${total} steps completed`);
  for (const failure of tour.failures) console.log(`[tour:${app}] ${failure}`);
}
