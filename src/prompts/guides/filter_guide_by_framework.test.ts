import { describe, expect, it } from "vitest";

import { filterGuideByFramework } from "./filter_guide_by_framework";

const SAMPLE = `# Title

Shared intro.

<nextjs-only>

## Next.js path

next-only content
</nextjs-only>

---

<vite-nitro-only>

## Vite + Nitro path

vite-only content
</vite-nitro-only>

Shared trailer.
`;

describe("filterGuideByFramework", () => {
  it("keeps the Next.js section and strips the Vite + Nitro section when frameworkType is nextjs", () => {
    const out = filterGuideByFramework(SAMPLE, "nextjs");

    expect(out).toContain("## Next.js path");
    expect(out).toContain("next-only content");
    expect(out).not.toContain("## Vite + Nitro path");
    expect(out).not.toContain("vite-only content");
    expect(out).not.toContain("<nextjs-only>");
    expect(out).not.toContain("</nextjs-only>");
    expect(out).not.toContain("<vite-nitro-only>");
    expect(out).not.toContain("</vite-nitro-only>");
    expect(out).toContain("Shared intro.");
    expect(out).toContain("Shared trailer.");
  });

  it.each(["vite-nitro", "vite"] as const)(
    "keeps the Vite + Nitro section and strips the Next.js section when frameworkType is %s",
    (fw) => {
      const out = filterGuideByFramework(SAMPLE, fw);

      expect(out).toContain("## Vite + Nitro path");
      expect(out).toContain("vite-only content");
      expect(out).not.toContain("## Next.js path");
      expect(out).not.toContain("next-only content");
      expect(out).not.toContain("<nextjs-only>");
      expect(out).not.toContain("</nextjs-only>");
      expect(out).not.toContain("<vite-nitro-only>");
      expect(out).not.toContain("</vite-nitro-only>");
    },
  );

  it("keeps both sections for unknown frameworks", () => {
    for (const fw of ["other", null] as const) {
      const out = filterGuideByFramework(SAMPLE, fw);

      expect(out).toContain("## Next.js path");
      expect(out).toContain("next-only content");
      expect(out).toContain("## Vite + Nitro path");
      expect(out).toContain("vite-only content");
      expect(out).not.toContain("<nextjs-only>");
      expect(out).not.toContain("</nextjs-only>");
      expect(out).not.toContain("<vite-nitro-only>");
      expect(out).not.toContain("</vite-nitro-only>");
    }
  });

  it("ignores inline mentions of the tag names in prose", () => {
    const withInline = `# Intro

Follow the \`<nextjs-only>\` section below, or the \`<vite-nitro-only>\`
section if you are on Vite.

<nextjs-only>
real next content
</nextjs-only>

<vite-nitro-only>
real vite content
</vite-nitro-only>
`;

    const out = filterGuideByFramework(withInline, "nextjs");

    // Intro prose with inline mentions stays intact.
    expect(out).toContain("Follow the `<nextjs-only>` section below");
    expect(out).toContain("`<vite-nitro-only>`\nsection if you are on Vite");
    // Real block content is filtered correctly.
    expect(out).toContain("real next content");
    expect(out).not.toContain("real vite content");
  });

  it("throws if the <nextjs-only> block is missing", () => {
    const onlyVite = `intro
<vite-nitro-only>
only vite
</vite-nitro-only>
trailer`;

    for (const fw of ["nextjs", "vite-nitro", "vite", "other", null] as const) {
      expect(() => filterGuideByFramework(onlyVite, fw)).toThrow(
        /<nextjs-only>/,
      );
    }
  });

  it("throws if the <vite-nitro-only> block is missing", () => {
    const onlyNext = `intro
<nextjs-only>
only next
</nextjs-only>
trailer`;

    for (const fw of ["nextjs", "vite-nitro", "vite", "other", null] as const) {
      expect(() => filterGuideByFramework(onlyNext, fw)).toThrow(
        /<vite-nitro-only>/,
      );
    }
  });
});
