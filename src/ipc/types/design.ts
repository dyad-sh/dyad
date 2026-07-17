import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { DESIGN_FONTS } from "./design_fonts";

// =============================================================================
// Design Mode Schemas
//
// Design mode lets users generate visual mockups ("interfaces") before any
// code is written. The AI first agrees on a global design system (the "brief":
// colors + typography + which screens to design) and then, for each interface,
// writes a snippet of Konva drawing code that the preview panel executes to
// render the mockup on a canvas.
// =============================================================================

/** Permissive 3- or 6-digit hex color, e.g. "#3B82F6" or "#39f". */
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const DesignPaletteSchema = z.object({
  primary: z.string().regex(HEX_COLOR_REGEX),
  secondary: z.string().regex(HEX_COLOR_REGEX),
  accent: z.string().regex(HEX_COLOR_REGEX),
  background: z.string().regex(HEX_COLOR_REGEX),
  surface: z.string().regex(HEX_COLOR_REGEX),
  text: z.string().regex(HEX_COLOR_REGEX),
  muted: z.string().regex(HEX_COLOR_REGEX).optional(),
});

export type DesignPalette = z.infer<typeof DesignPaletteSchema>;

/**
 * Only fonts the app bundles can be used — Konva rasterizes to canvas, which
 * falls back silently to a default face for anything not loaded in the
 * document. An enum (not a free string) is what makes that impossible to get
 * wrong. See `design_fonts.ts`.
 */
export const DesignFontSchema = z.enum(DESIGN_FONTS);

export const DesignTypographySchema = z.object({
  headingFont: DesignFontSchema,
  bodyFont: DesignFontSchema,
  /** Base body font size in px (e.g. 16). */
  baseSize: z.number().positive().optional(),
});

export type DesignTypography = z.infer<typeof DesignTypographySchema>;

// -----------------------------------------------------------------------------
// Design options (the pre-generation choice step)
//
// Before committing a brief, the agent proposes a few tailored options for each
// major decision and the user picks. The selection is authoritative: the
// confirmed values are what `write_design_brief` records, so the model cannot
// drift from what the user actually chose.
// -----------------------------------------------------------------------------

/** Platforms a design can target. Drives the mockup frame dimensions. */
export const DesignPlatformSchema = z.enum(["desktop", "mobile", "both"]);

export type DesignPlatform = z.infer<typeof DesignPlatformSchema>;

export const DesignDirectionOptionSchema = z.object({
  id: z.string(),
  /** Short name for the position, e.g. "Print cookbook". */
  title: z.string(),
  /** 1-2 sentence pitch for this thesis. */
  pitch: z.string(),
});

export type DesignDirectionOption = z.infer<typeof DesignDirectionOptionSchema>;

export const DesignPaletteOptionSchema = z.object({
  id: z.string(),
  /** Evocative name, e.g. "Warm ember". */
  name: z.string(),
  rationale: z.string().optional(),
  palette: DesignPaletteSchema,
});

export type DesignPaletteOption = z.infer<typeof DesignPaletteOptionSchema>;

export const DesignTypographyOptionSchema = z.object({
  id: z.string(),
  headingFont: DesignFontSchema,
  bodyFont: DesignFontSchema,
  rationale: z.string().optional(),
});

export type DesignTypographyOption = z.infer<
  typeof DesignTypographyOptionSchema
>;

export const DesignShapeOptionSchema = z.object({
  id: z.string(),
  /** e.g. "Hard edge", "Soft", "Pill". */
  label: z.string(),
  /** Corner radius in px applied to buttons/cards in the mockups. */
  cornerRadius: z.number().min(0).max(200),
});

export type DesignShapeOption = z.infer<typeof DesignShapeOptionSchema>;

/** The full set of choices presented to the user for one design. */
export const DesignOptionsDataSchema = z.object({
  /** Correlates the UI's response with the waiting agent tool call. */
  requestId: z.string(),
  directions: z.array(DesignDirectionOptionSchema).min(2).max(3),
  palettes: z.array(DesignPaletteOptionSchema).min(2).max(3),
  typography: z.array(DesignTypographyOptionSchema).min(2).max(3),
  shapes: z.array(DesignShapeOptionSchema).min(2).max(3),
  /** Which platform choices to offer. */
  platforms: z.array(DesignPlatformSchema).min(1).max(3),
});

export type DesignOptionsData = z.infer<typeof DesignOptionsDataSchema>;

/** What the user picked — ids referencing the offered options. */
export const DesignOptionsSelectionSchema = z.object({
  directionId: z.string(),
  paletteId: z.string(),
  typographyId: z.string(),
  shapeId: z.string(),
  platform: DesignPlatformSchema,
});

export type DesignOptionsSelection = z.infer<
  typeof DesignOptionsSelectionSchema
>;

/** `selection: null` means the user dismissed the step without choosing. */
export const DesignOptionsResponseSchema = z.object({
  requestId: z.string(),
  selection: DesignOptionsSelectionSchema.nullable(),
});

export type DesignOptionsResponsePayload = z.infer<
  typeof DesignOptionsResponseSchema
>;

export const DesignInterfaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
});

export type DesignInterfaceSummary = z.infer<
  typeof DesignInterfaceSummarySchema
>;

export const DesignBriefDataSchema = z.object({
  appName: z.string(),
  userPrompt: z.string(),
  designDirection: z.string(),
  palette: DesignPaletteSchema,
  typography: DesignTypographySchema,
  interfaces: z.array(DesignInterfaceSummarySchema),
  /**
   * Committed from the user's options selection. Optional so briefs persisted
   * before the options step (or written without one) still load.
   */
  cornerRadius: z.number().min(0).max(200).optional(),
  platform: DesignPlatformSchema.optional(),
});

export type DesignBriefData = z.infer<typeof DesignBriefDataSchema>;

// -----------------------------------------------------------------------------
// Interface (per-screen Konva drawing code)
// -----------------------------------------------------------------------------

export const DesignInterfaceDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
  /** Canvas width in px (e.g. 1440 desktop, 390 mobile). */
  width: z.number().positive(),
  /** Canvas height in px. */
  height: z.number().positive(),
  /** Background color of the frame. */
  background: z.string(),
  /** Aesthetic rationale / copy notes shown alongside the mockup. */
  notes: z.string().optional(),
  /**
   * JavaScript that draws the screen with Konva. The renderer runs it as
   * `new Function("Konva", "layer", "width", "height", code)`, so the code adds
   * shapes to the provided `layer` (already attached to a scaled stage) using
   * the `Konva` constructors and the `width`/`height` of the canvas.
   */
  code: z.string(),
});

export type DesignInterfaceData = z.infer<typeof DesignInterfaceDataSchema>;

// -----------------------------------------------------------------------------
// Persisted design state
// -----------------------------------------------------------------------------

/**
 * The full design produced for a chat: the global brief (null until committed)
 * plus every generated interface, in generation order. Mirrored to disk under
 * `<appPath>/.dyad/designs/<chatId>.json` so mockups survive reloads.
 */
export const DesignStateSchema = z.object({
  brief: DesignBriefDataSchema.nullable(),
  interfaces: z.array(DesignInterfaceDataSchema),
});

export type DesignState = z.infer<typeof DesignStateSchema>;

// =============================================================================
// Design Contracts (Renderer -> Main invoke/response)
// =============================================================================

export const designContracts = {
  getDesignState: defineContract({
    channel: "design:get-state",
    input: z.object({ chatId: z.number() }),
    output: DesignStateSchema,
  }),

  /**
   * Sent when the user confirms (or dismisses) the options step, unblocking the
   * `propose_design_options` tool call that is awaiting their choice.
   */
  respondToDesignOptions: defineContract({
    channel: "design:options-response",
    input: DesignOptionsResponseSchema,
    output: z.void(),
  }),
} as const;

export const designClient = createClient(designContracts);

// =============================================================================
// Design Events (Main -> Renderer)
// =============================================================================

export const DesignBriefUpdatePayloadSchema = z.object({
  chatId: z.number(),
  data: DesignBriefDataSchema,
});

export type DesignBriefUpdatePayload = z.infer<
  typeof DesignBriefUpdatePayloadSchema
>;

export const DesignInterfaceUpdatePayloadSchema = z.object({
  chatId: z.number(),
  data: DesignInterfaceDataSchema,
});

export type DesignInterfaceUpdatePayload = z.infer<
  typeof DesignInterfaceUpdatePayloadSchema
>;

export const DesignOptionsRequestPayloadSchema = z.object({
  chatId: z.number(),
  data: DesignOptionsDataSchema,
});

export type DesignOptionsRequestPayload = z.infer<
  typeof DesignOptionsRequestPayloadSchema
>;

export const designEvents = {
  /** Ask the design panel to present the options step and await a choice. */
  optionsRequest: defineEvent({
    channel: "design:options-request",
    payload: DesignOptionsRequestPayloadSchema,
  }),

  briefUpdate: defineEvent({
    channel: "design:brief-update",
    payload: DesignBriefUpdatePayloadSchema,
  }),

  interfaceUpdate: defineEvent({
    channel: "design:interface-update",
    payload: DesignInterfaceUpdatePayloadSchema,
  }),
} as const;

export const designEventClient = createEventClient(designEvents);
