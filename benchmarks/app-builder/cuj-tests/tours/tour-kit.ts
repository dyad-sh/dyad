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
            "bottom:0",
            "left:0",
            "right:0",
            "z-index:2147483647",
            "background:rgba(15,23,42,0.9)",
            "color:#f8fafc",
            "font:600 20px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif",
            "padding:10px 18px",
            "letter-spacing:0.01em",
            "pointer-events:none",
            "box-shadow:0 -2px 14px rgba(0,0,0,0.35)",
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
      await page.waitForTimeout(Math.round(700 * TOUR_PACE));
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
      await page.waitForTimeout(Math.round(400 * TOUR_PACE));
    },
  };
}

/** Log the tour outcome; a tour never fails the test run. */
export function reportTour(app: string, tour: Tour, total: number): void {
  const passed = total - tour.failures.length;
  console.log(`\n[tour:${app}] ${passed}/${total} steps completed`);
  for (const failure of tour.failures) console.log(`[tour:${app}] ${failure}`);
}

// ---------------------------------------------------------------------------
// Demo recording knobs (env-driven so the tours stay usable at default pace).
//
//   TOUR_ZOOM   CSS zoom applied inside every page (default 1). Playwright's
//               video is captured at CSS-pixel size and ignores
//               deviceScaleFactor, so "zoom" must happen in the document: the
//               UI renders larger and the layout reflows to a narrower logical
//               width — exactly what a demo wants.
//   TOUR_PACE   multiplier on every dwell/pause in the tour (default 1).
//   TOUR_TITLE / TOUR_SUBTITLE  shown on an opening title card when set.
// ---------------------------------------------------------------------------
export const TOUR_PACE = Number(process.env.TOUR_PACE || "1");
export const TOUR_ZOOM = Number(process.env.TOUR_ZOOM || "1");
const VIEW_W = TOUR_ZOOM > 1 ? 1600 : 1280;
const VIEW_H = TOUR_ZOOM > 1 ? 1000 : 720;

/** Browser-context options for a tour recording (video size == viewport). */
export function tourContextOptions(videoDir: string): Record<string, unknown> {
  return {
    viewport: { width: VIEW_W, height: VIEW_H },
    recordVideo: { dir: videoDir, size: { width: VIEW_W, height: VIEW_H } },
  };
}

/** Apply TOUR_ZOOM to every document this page loads (survives navigation). */
export async function applyZoom(page: Page): Promise<void> {
  if (TOUR_ZOOM <= 1) return;
  await page.addInitScript((z: number) => {
    const apply = () => {
      if (document.documentElement) {
        (document.documentElement.style as any).zoom = String(z);
      }
    };
    apply();
    document.addEventListener("DOMContentLoaded", apply);
  }, TOUR_ZOOM);
}

/** A pause that respects TOUR_PACE. */
export async function dwell(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(Math.round(ms * TOUR_PACE));
}

/**
 * Full-screen title card rendered in the page itself (no ffmpeg text filters
 * needed). Used at the start (and end) of a demo recording when TOUR_TITLE is
 * set; a no-op otherwise so scoring-adjacent runs are unaffected.
 */
export async function titleCard(
  page: Page,
  title: string,
  subtitle: string,
  ms = 3_000,
): Promise<void> {
  if (!title) return;
  await page.goto("about:blank").catch(() => undefined);
  await page
    .setContent(
      `<body style="margin:0;background:#0f172a;color:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center;max-width:80%">
          <div style="font-size:40px;font-weight:700;letter-spacing:-0.01em">${title}</div>
          <div style="font-size:22px;margin-top:18px;color:#cbd5e1">${subtitle}</div>
        </div></body>`,
    )
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}
