import { DESIGN_FONTS } from "@/ipc/types/design_fonts";

/**
 * Ensures every design-mode font is loaded before a mockup is rasterized.
 *
 * Two gotchas this exists to handle:
 *
 * 1. Drawing text to a canvas does NOT trigger a lazy @font-face fetch the way
 *    rendering DOM text does. The font is simply "not loaded" at draw time and
 *    canvas substitutes a default face, with no error. So we have to ask for
 *    each face explicitly via `document.fonts.load`.
 * 2. Even then the fetch is async, so the first `layer.draw()` would still miss
 *    it. Callers await this and redraw.
 *
 * The result is memoized: the fetches happen once per session, and every later
 * mockup resolves immediately.
 */

// Weights the mockups actually draw with. Variable fonts serve any weight from
// one file, so this is about telling the font loader which instances to
// prepare, not about how many files get fetched.
const WEIGHTS = [400, 500, 700] as const;

let loadPromise: Promise<void> | null = null;

export function loadDesignFonts(): Promise<void> {
  if (loadPromise) return loadPromise;

  if (typeof document === "undefined" || !document.fonts) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  const requests = DESIGN_FONTS.flatMap((family) =>
    WEIGHTS.map((weight) =>
      // A font the browser can't resolve rejects; a mockup using the rest
      // should still render, so failures are swallowed per-face.
      document.fonts.load(`${weight} 16px "${family}"`).catch(() => []),
    ),
  );

  loadPromise = Promise.all(requests).then(() => undefined);
  return loadPromise;
}
