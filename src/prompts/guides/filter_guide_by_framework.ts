import type { AppFrameworkType } from "@/lib/framework_constants";

// Tags must occupy their own line — guide bodies mention the literal strings
// `<nextjs-only>` / `<vite-nitro-only>` inline (e.g. "Follow the `<nextjs-only>`
// section below."), and a loose regex would gobble everything between them.
const NEXTJS_BLOCK = /^<nextjs-only>$[\s\S]*?^<\/nextjs-only>$\n?/gm;
const VITE_NITRO_BLOCK =
  /^<vite-nitro-only>$[\s\S]*?^<\/vite-nitro-only>$\n?/gm;
const NEXTJS_TAGS = /^<\/?nextjs-only>$\n?/gm;
const VITE_NITRO_TAGS = /^<\/?vite-nitro-only>$\n?/gm;
// Non-global twins for existence checks — reusing the /g variants would mutate
// `lastIndex` between calls and produce inconsistent results.
const HAS_NEXTJS_BLOCK = /^<nextjs-only>$[\s\S]*?^<\/nextjs-only>$/m;
const HAS_VITE_NITRO_BLOCK = /^<vite-nitro-only>$[\s\S]*?^<\/vite-nitro-only>$/m;

/**
 * Strip the framework section that doesn't apply to the current runtime from
 * a guide's markdown. Guides bundle both the Next.js and Vite + Nitro paths
 * for ease of maintenance; we only ship the one that matches.
 *
 * Plain "vite" maps to the Vite + Nitro path because Dyad adds a Nitro layer
 * when Neon is connected to a Vite app.
 *
 * Unknown frameworks ("other", null) keep both sections — the caller doesn't
 * have enough signal to choose.
 */
export function filterGuideByFramework(
  markdown: string,
  frameworkType: AppFrameworkType | null,
): string {
  if (!HAS_NEXTJS_BLOCK.test(markdown)) {
    throw new Error(
      "Guide is missing required <nextjs-only>...</nextjs-only> block",
    );
  }
  if (!HAS_VITE_NITRO_BLOCK.test(markdown)) {
    throw new Error(
      "Guide is missing required <vite-nitro-only>...</vite-nitro-only> block",
    );
  }
  if (frameworkType === "nextjs") {
    return markdown.replace(VITE_NITRO_BLOCK, "").replace(NEXTJS_TAGS, "");
  }
  if (frameworkType === "vite-nitro" || frameworkType === "vite") {
    return markdown.replace(NEXTJS_BLOCK, "").replace(VITE_NITRO_TAGS, "");
  }
  return markdown.replace(NEXTJS_TAGS, "").replace(VITE_NITRO_TAGS, "");
}
