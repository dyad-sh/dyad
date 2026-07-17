/**
 * The design-mode font roster.
 *
 * Konva rasterizes text to a canvas, which silently falls back to a default
 * face if the requested family isn't loaded in the document — so a mockup can
 * only use fonts this app actually bundles. Every family here is imported by
 * `src/styles/globals.css`; the design tools constrain the model to this list
 * via `DesignFontSchema`. Adding a font means doing BOTH: install the
 * @fontsource package + @import it in globals.css, then add it here.
 */
export const DESIGN_FONTS = [
  "Inter Variable",
  "Space Grotesk Variable",
  "Bricolage Grotesque Variable",
  "Playfair Display Variable",
  "Fraunces Variable",
  "Instrument Serif",
  "JetBrains Mono Variable",
  "Geist",
  "Georgia",
] as const;

export type DesignFont = (typeof DESIGN_FONTS)[number];

/**
 * How each font behaves, for the model's benefit. Keep in sync with
 * DESIGN_FONTS — this is what gets injected into the prompt so the model picks
 * a pairing on purpose rather than defaulting to the safest sans.
 */
export const DESIGN_FONT_NOTES: Record<DesignFont, string> = {
  "Inter Variable":
    "Neutral UI sans. Invisible by design — use for body, labels, and dense data, rarely for display.",
  "Space Grotesk Variable":
    "Geometric sans with quirky details. Technical, modern, slightly offbeat. Strong at display sizes.",
  "Bricolage Grotesque Variable":
    "Characterful contemporary grotesque. Editorial and confident; excellent for big headlines.",
  "Playfair Display Variable":
    "High-contrast didone serif. Luxury, fashion, editorial. Needs large sizes and tight tracking.",
  "Fraunces Variable":
    "Soft, wonky old-style serif. Warm and crafted — good for food, wellness, indie brands.",
  "Instrument Serif":
    "Elegant light display serif. Understated and expensive-looking at very large sizes.",
  "JetBrains Mono Variable":
    "Monospace. Developer tools, data, terminals, or as a deliberate accent for eyebrows/metadata.",
  Geist: "Clean modern sans. A slightly warmer alternative to Inter.",
  Georgia:
    "Classic readable serif. Long-form reading, journalism, book-like body text.",
};
