import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

// =============================================================================
// Design Spec Schemas
//
// Design mode produces a structured, per-chat "design spec" describing the
// app's visual system and the individual interfaces (screens) that will be
// generated as images. Persisted to `.dyad/design/<chatId>.json` and rendered
// in the Design preview panel.
// =============================================================================

export const DesignColorSchema = z.object({
  name: z.string(),
  hex: z.string(),
});
export type DesignColor = z.infer<typeof DesignColorSchema>;

export const DesignTypographySchema = z.object({
  heading: z.string(),
  body: z.string(),
  notes: z.string().optional(),
});
export type DesignTypography = z.infer<typeof DesignTypographySchema>;

export const DesignSystemSchema = z.object({
  mood: z.string(),
  colors: z.array(DesignColorSchema),
  typography: DesignTypographySchema,
  spacing: z.string().optional(),
  notes: z.string().optional(),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

export const DesignInterfaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  /** Full descriptive image-generation prompt (layout, aesthetics, media, copy). */
  prompt: z.string(),
  /** Key copy strings for the screen. */
  copy: z.string().optional(),
  /**
   * Relative path (within the app dir, under `.dyad/media`) of the generated
   * image for this interface. Absent until the image has been generated.
   */
  imagePath: z.string().optional(),
});
export type DesignInterface = z.infer<typeof DesignInterfaceSchema>;

export const DesignSpecSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  designSystem: DesignSystemSchema,
  interfaces: z.array(DesignInterfaceSchema),
});
export type DesignSpec = z.infer<typeof DesignSpecSchema>;

// The persisted record adds ownership + timestamps around the spec.
export const StoredDesignSpecSchema = DesignSpecSchema.extend({
  appId: z.number(),
  chatId: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoredDesignSpec = z.infer<typeof StoredDesignSpecSchema>;

// =============================================================================
// Events (Main -> Renderer)
// =============================================================================

export const DesignUpdateSchema = z.object({
  chatId: z.number(),
  spec: DesignSpecSchema,
});
export type DesignUpdatePayload = z.infer<typeof DesignUpdateSchema>;

export const designEvents = {
  update: defineEvent({
    channel: "design:update",
    payload: DesignUpdateSchema,
  }),
} as const;

// =============================================================================
// CRUD Contracts (Invoke/Response)
// =============================================================================

export const SaveDesignSpecParamsSchema = z.object({
  appId: z.number(),
  chatId: z.number(),
  spec: DesignSpecSchema,
});
export type SaveDesignSpecParams = z.infer<typeof SaveDesignSpecParamsSchema>;

export const designContracts = {
  saveDesignSpec: defineContract({
    channel: "design:save",
    input: SaveDesignSpecParamsSchema,
    output: StoredDesignSpecSchema,
  }),

  getDesignForChat: defineContract({
    channel: "design:get-for-chat",
    input: z.object({ appId: z.number(), chatId: z.number() }),
    output: StoredDesignSpecSchema.nullable(),
  }),

  deleteDesignSpec: defineContract({
    channel: "design:delete",
    input: z.object({ appId: z.number(), chatId: z.number() }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Clients
// =============================================================================

export const designEventClient = createEventClient(designEvents);
export const designClient = createClient(designContracts);
