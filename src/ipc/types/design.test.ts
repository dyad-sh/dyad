import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  DesignBriefDataSchema,
  DesignInterfaceDataSchema,
  DesignPaletteSchema,
} from "./design";
import { DESIGN_FONTS, DESIGN_FONT_NOTES } from "./design_fonts";

// Mockups are drawn to a canvas, which silently substitutes a default face for
// any font not loaded in the document — a broken font produces an ugly screen,
// never an error. So the roster and the stylesheet drifting apart is a failure
// nobody would notice at runtime. Pin them together here instead.
describe("design font roster", () => {
  const globalsCss = fs.readFileSync(
    path.join(__dirname, "../../styles/globals.css"),
    "utf-8",
  );

  it.each(DESIGN_FONTS)("%s is imported by globals.css", (font) => {
    // "Inter Variable" -> @fontsource-variable/inter
    // "Instrument Serif" -> @fontsource/instrument-serif
    const isVariable = font.endsWith(" Variable");
    const slug = font
      .replace(/ Variable$/, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    const pkg = isVariable
      ? `@fontsource-variable/${slug}`
      : `@fontsource/${slug}`;
    // Geist is bundled via hand-written @font-face rules rather than fontsource.
    const expected = font === "Geist" ? 'font-family: "Geist"' : pkg;
    expect(globalsCss).toContain(expected);
  });

  it("documents every font, so the prompt can explain the choice", () => {
    for (const font of DESIGN_FONTS) {
      expect(DESIGN_FONT_NOTES[font], `missing note for ${font}`).toBeTruthy();
    }
    expect(Object.keys(DESIGN_FONT_NOTES).sort()).toEqual(
      [...DESIGN_FONTS].sort(),
    );
  });

  it("ships every font rather than trusting the OS to have it", () => {
    // Georgia lived here until a render check caught it falling back on Linux.
    // A system font is only "safe" on the platforms that happen to install it.
    const systemFonts = [
      "Georgia",
      "Arial",
      "Helvetica",
      "Times New Roman",
      "system-ui",
    ];
    expect(DESIGN_FONTS.filter((f) => systemFonts.includes(f))).toEqual([]);
  });
});

describe("DesignPaletteSchema", () => {
  it("accepts 3- and 6-digit hex colors", () => {
    const parsed = DesignPaletteSchema.parse({
      primary: "#3B82F6",
      secondary: "#39f",
      accent: "#FFBA08",
      background: "#ffffff",
      surface: "#FFFFFF",
      text: "#111",
    });
    expect(parsed.primary).toBe("#3B82F6");
  });

  it("rejects non-hex color strings", () => {
    expect(() =>
      DesignPaletteSchema.parse({
        primary: "blue",
        secondary: "#39f",
        accent: "#FFBA08",
        background: "#ffffff",
        surface: "#FFFFFF",
        text: "#111",
      }),
    ).toThrow();
  });

  it("treats muted as optional", () => {
    const parsed = DesignPaletteSchema.parse({
      primary: "#3B82F6",
      secondary: "#39f",
      accent: "#FFBA08",
      background: "#ffffff",
      surface: "#FFFFFF",
      text: "#111",
    });
    expect(parsed.muted).toBeUndefined();
  });
});

describe("DesignBriefDataSchema", () => {
  it("parses a full brief", () => {
    const brief = DesignBriefDataSchema.parse({
      appName: "FreshBite",
      userPrompt: "A restaurant site with online ordering",
      designDirection: "Warm and appetizing, modern editorial feel.",
      palette: {
        primary: "#E85D04",
        secondary: "#6A040F",
        accent: "#FFBA08",
        background: "#FFFDF9",
        surface: "#FFFFFF",
        text: "#1B1B1B",
      },
      typography: {
        headingFont: "Instrument Serif",
        bodyFont: "Inter Variable",
        baseSize: 16,
      },
      interfaces: [
        { id: "s1", name: "Landing page", purpose: "Sell the vibe" },
        { id: "s2", name: "Menu" },
      ],
    });
    expect(brief.interfaces).toHaveLength(2);
    expect(brief.typography.headingFont).toBe("Instrument Serif");
  });
});

describe("DesignInterfaceDataSchema", () => {
  it("parses an interface with Konva drawing code", () => {
    const data = DesignInterfaceDataSchema.parse({
      id: "iface_1",
      name: "Landing page",
      width: 1440,
      height: 1024,
      background: "#FFFDF9",
      notes: "Editorial hero with a single clear CTA.",
      code: "layer.add(new Konva.Rect({ x: 0, y: 0, width: 1440, height: 72, fill: '#FFFFFF' }));",
    });
    expect(data.code).toContain("Konva.Rect");
    expect(data.width).toBe(1440);
  });

  it("rejects a non-positive canvas width", () => {
    expect(() =>
      DesignInterfaceDataSchema.parse({
        id: "iface_1",
        name: "Landing page",
        width: 0,
        height: 1024,
        background: "#FFFDF9",
        code: "layer.add(new Konva.Rect({ x: 0, y: 0 }));",
      }),
    ).toThrow();
  });
});
