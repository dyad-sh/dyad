import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";
import { designOptionsResolver } from "../userInputResolvers";
import {
  DesignOptionsDataSchema,
  DesignPlatformSchema,
  DesignPaletteSchema,
  DesignFontSchema,
} from "@/ipc/types/design";

const logger = log.scope("propose_design_options");

const DirectionOptionInput = z.object({
  title: z
    .string()
    .describe('Short name for the position, e.g. "Print cookbook"'),
  pitch: z.string().describe("1-2 sentence pitch for this thesis"),
});

const PaletteOptionInput = z.object({
  name: z.string().describe('Evocative name, e.g. "Warm ember"'),
  rationale: z.string().optional().describe("One line on why it fits"),
  palette: DesignPaletteSchema,
});

const TypographyOptionInput = z.object({
  headingFont: DesignFontSchema,
  bodyFont: DesignFontSchema,
  rationale: z
    .string()
    .optional()
    .describe("One line on why this pairing fits"),
});

const ShapeOptionInput = z.object({
  label: z.string().describe('e.g. "Hard edge", "Soft", "Pill"'),
  cornerRadius: z
    .number()
    .min(0)
    .max(200)
    .describe("Corner radius in px applied to buttons/cards in the mockups"),
});

const proposeDesignOptionsSchema = z.object({
  directions: z.array(DirectionOptionInput).min(2).max(3),
  palettes: z.array(PaletteOptionInput).min(2).max(3),
  typography: z.array(TypographyOptionInput).min(2).max(3),
  shapes: z.array(ShapeOptionInput).min(2).max(3),
  platforms: z
    .array(DesignPlatformSchema)
    .min(1)
    .max(3)
    .describe("Which platform choices to offer"),
});

const DESCRIPTION = `Present the user with a small set of tailored design choices and WAIT for them to pick. Returns their selection, which is authoritative — the brief you write next must use exactly what they chose.

<when_to_use>
Call this ONCE, after you understand the app (from the user's prompt or planning_questionnaire) and BEFORE write_design_brief. This is the step where the user, not you, decides the visual position.
</when_to_use>

<why>
Design is subjective, and a single "reasonable" direction picked by you is how mockups end up looking averaged and generic. Offering 2-3 genuinely different positions and letting the user choose is what makes the result feel like theirs. So the options must be REAL alternatives, not three shades of the same safe idea:
- Two directions that differ only in accent color are not two options.
- Make each direction defensible but distinct enough that choosing between them is a real decision.
</why>

<guidelines>
- directions: 2-3 theses. Each needs a specific position, ideally with a named influence ("the density of a Bloomberg terminal", "Swiss editorial"). Never offer "modern and clean" — it commits to nothing.
- palettes: 2-3, each mostly neutrals with ONE accent that earns its place. Give each an evocative name.
- typography: 2-3 pairings from the allowed fonts. Pick pairings that serve different directions rather than three variations on the same sans.
- shapes: 2-3 corner-radius choices, 0-200px. Spread them — 0 (hard edge), 12 (soft), 28 (pill, i.e. half a standard 56px button height) are three real choices; 8/10/12 is one choice pretending to be three.
- platforms: offer what actually makes sense for this product. A single-element array is fine when the platform is obvious.
</guidelines>

<example>
{
  "directions": [
    { "title": "Print cookbook", "pitch": "Enormous light serif, oceans of margin, one photo doing all the work. Ordering is a quiet transaction at the end, not a storefront." },
    { "title": "Neighborhood diner", "pitch": "Dense, warm and busy — a chalkboard menu energy where the food list IS the hero and everything is one tap away." }
  ],
  "palettes": [
    { "name": "Paper and ink", "rationale": "Reads like a cookbook page.", "palette": { "primary": "#1B1B1B", "secondary": "#6B6560", "accent": "#C2410C", "background": "#FAF8F5", "surface": "#F1EDE7", "text": "#1B1B1B", "muted": "#9A938B" } },
    { "name": "Ember", "rationale": "Warmer and louder, for the diner read.", "palette": { "primary": "#7C2D12", "secondary": "#9A3412", "accent": "#FBBF24", "background": "#FFFBF5", "surface": "#FDF2E3", "text": "#1C1917", "muted": "#87796B" } }
  ],
  "typography": [
    { "headingFont": "Instrument Serif", "bodyFont": "Inter Variable", "rationale": "Light display serif is what 'print cookbook' means." },
    { "headingFont": "Bricolage Grotesque Variable", "bodyFont": "Inter Variable", "rationale": "Characterful grotesque for the busier, louder read." }
  ],
  "shapes": [
    { "label": "Hard edge", "cornerRadius": 0 },
    { "label": "Soft", "cornerRadius": 12 },
    { "label": "Pill", "cornerRadius": 28 }
  ],
  "platforms": ["desktop", "mobile"]
}
</example>`;

export const proposeDesignOptionsTool: ToolDefinition<
  z.infer<typeof proposeDesignOptionsSchema>
> = {
  name: "propose_design_options",
  description: DESCRIPTION,
  inputSchema: proposeDesignOptionsSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: () => "Design options",

  execute: async (args, ctx: AgentContext) => {
    const requestId = `design_options:${crypto.randomUUID()}`;

    // Ids correlate the user's pick back to the option they saw, so the model
    // never has to re-describe its own proposals.
    const withIds = <T>(items: T[], prefix: string) =>
      items.map((item, i) => ({ ...item, id: `${prefix}_${i + 1}` }));

    const data = DesignOptionsDataSchema.parse({
      requestId,
      directions: withIds(args.directions, "dir"),
      palettes: withIds(args.palettes, "pal"),
      typography: withIds(args.typography, "typ"),
      shapes: withIds(args.shapes, "shape"),
      platforms: args.platforms,
    });

    logger.log(
      `Presenting design options (${data.directions.length} directions), requestId: ${requestId}`,
    );

    safeSend(ctx.event.sender, "design:options-request", {
      chatId: ctx.chatId,
      data,
    });

    const selection = await designOptionsResolver.wait(requestId, ctx.chatId);

    if (!selection) {
      return "The user dismissed the design options without choosing. Ask them how they'd like to proceed — do not guess a direction and continue.";
    }

    const direction = data.directions.find(
      (d) => d.id === selection.directionId,
    );
    const palette = data.palettes.find((p) => p.id === selection.paletteId);
    const typography = data.typography.find(
      (t) => t.id === selection.typographyId,
    );
    const shape = data.shapes.find((s) => s.id === selection.shapeId);

    ctx.onXmlComplete(
      `<dyad-design-options direction="${escapeXmlAttr(direction?.title ?? "")}" palette="${escapeXmlAttr(palette?.name ?? "")}" complete="true"></dyad-design-options>`,
    );

    // Spell the choice back as the exact values write_design_brief must record.
    // The user picked these; the model does not get to reinterpret them.
    return `The user chose:

- Direction: ${direction?.title ?? "(unknown)"} — ${direction?.pitch ?? ""}
- Palette: ${palette?.name ?? "(unknown)"} — ${JSON.stringify(palette?.palette ?? {})}
- Typography: ${typography?.headingFont ?? "?"} (headings) / ${typography?.bodyFont ?? "?"} (body)
- Shape: ${shape?.label ?? "?"} — cornerRadius ${shape?.cornerRadius ?? 0}
- Platform: ${selection.platform}

Call write_design_brief now using EXACTLY these values — the palette hex codes, the fonts, cornerRadius ${shape?.cornerRadius ?? 0}, and platform "${selection.platform}". Build the design_direction around the chosen thesis. Do not substitute your own preferences; the user already decided.`;
  },
};
