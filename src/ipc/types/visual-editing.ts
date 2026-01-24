import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Visual Editing Schemas
// =============================================================================

export const VisualEditingChangeSchema = z.object({
  componentId: z.string(),
  componentName: z.string(),
  relativePath: z.string(),
  lineNumber: z.number(),
  styles: z.object({
    margin: z
      .object({
        left: z.string().optional(),
        right: z.string().optional(),
        top: z.string().optional(),
        bottom: z.string().optional(),
      })
      .optional(),
    padding: z
      .object({
        left: z.string().optional(),
        right: z.string().optional(),
        top: z.string().optional(),
        bottom: z.string().optional(),
      })
      .optional(),
    dimensions: z
      .object({
        width: z.string().optional(),
        height: z.string().optional(),
      })
      .optional(),
    border: z
      .object({
        width: z.string().optional(),
        radius: z.string().optional(),
        color: z.string().optional(),
      })
      .optional(),
    backgroundColor: z.string().optional(),
    text: z
      .object({
        fontSize: z.string().optional(),
        fontWeight: z.string().optional(),
        color: z.string().optional(),
        fontFamily: z.string().optional(),
      })
      .optional(),
  }),
  textContent: z.string().optional(),
});

export type VisualEditingChange = z.infer<typeof VisualEditingChangeSchema>;

export const ApplyVisualEditingChangesParamsSchema = z.object({
  appId: z.number(),
  changes: z.array(VisualEditingChangeSchema),
});

export type ApplyVisualEditingChangesParams = z.infer<
  typeof ApplyVisualEditingChangesParamsSchema
>;

export const AnalyseComponentParamsSchema = z.object({
  appId: z.number(),
  componentId: z.string(),
});

export type AnalyseComponentParams = z.infer<
  typeof AnalyseComponentParamsSchema
>;

export const AnalyseComponentResultSchema = z.object({
  isDynamic: z.boolean(),
  hasStaticText: z.boolean(),
});

// =============================================================================
// Visual Editing Contracts
// =============================================================================

export const visualEditingContracts = {
  applyChanges: defineContract({
    channel: "apply-visual-editing-changes",
    input: ApplyVisualEditingChangesParamsSchema,
    output: z.void(),
  }),

  analyzeComponent: defineContract({
    channel: "analyze-component",
    input: AnalyseComponentParamsSchema,
    output: AnalyseComponentResultSchema,
  }),
} as const;

// =============================================================================
// Visual Editing Client
// =============================================================================

export const visualEditingClient = createClient(visualEditingContracts);
