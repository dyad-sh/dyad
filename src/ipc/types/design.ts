import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

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

export const DesignTypographySchema = z.object({
  headingFont: z.string(),
  bodyFont: z.string(),
  /** Base body font size in px (e.g. 16). */
  baseSize: z.number().positive().optional(),
});

export type DesignTypography = z.infer<typeof DesignTypographySchema>;

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

export const designEvents = {
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
