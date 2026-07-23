import { z } from "zod";

/**
 * Shared model for the preview test recorder.
 *
 * The injected recorder client (`worker/dyad-recorder-client.js`) posts
 * `RecordedAction`s to the renderer, which buffers them as `RecordedEntry`s,
 * collapses them (see `merge.ts`), and generates a Playwright spec (`codegen.ts`).
 * These are validated at the postMessage boundary with `parseRecorderAction`
 * because the payload originates in the previewed app's frame.
 */

export const LocatorKindSchema = z.enum([
  "testid",
  "role",
  "placeholder",
  "label",
  "text",
  "dyadId",
  "css",
]);
export type LocatorKind = z.infer<typeof LocatorKindSchema>;

export const LocatorDescriptorSchema = z.object({
  kind: LocatorKindSchema,
  value: z.string(),
  /** Accessible name, only for `kind: "role"`. */
  name: z.string().optional(),
  /** Whether the match is exact (used for `kind: "text"`). */
  exact: z.boolean().optional(),
  /** Zero-based index when the locator matches multiple elements. */
  nth: z.number().int().nonnegative().optional(),
});
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;

export const RecordedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), locator: LocatorDescriptorSchema }),
  z.object({ kind: z.literal("dblclick"), locator: LocatorDescriptorSchema }),
  z.object({
    kind: z.literal("fill"),
    locator: LocatorDescriptorSchema,
    value: z.string(),
  }),
  z.object({
    kind: z.literal("press"),
    locator: LocatorDescriptorSchema,
    key: z.string(),
  }),
  z.object({ kind: z.literal("check"), locator: LocatorDescriptorSchema }),
  z.object({ kind: z.literal("uncheck"), locator: LocatorDescriptorSchema }),
  z.object({
    kind: z.literal("select"),
    locator: LocatorDescriptorSchema,
    values: z.array(z.string()),
  }),
  // `navigate` has no locator: it is synthesized in the renderer from the
  // preview's pushState/replaceState messages while recording is active.
  z.object({ kind: z.literal("navigate"), path: z.string() }),
]);
export type RecordedAction = z.infer<typeof RecordedActionSchema>;

export interface RecordedEntry {
  action: RecordedAction;
  /** Epoch ms the action was observed; used to merge click→dblclick. */
  at: number;
}

/**
 * Validate an untrusted `dyad-recorder-action` postMessage payload. Returns the
 * parsed action, or null when the payload is malformed.
 */
export function parseRecorderAction(data: unknown): RecordedAction | null {
  const result = RecordedActionSchema.safeParse(data);
  return result.success ? result.data : null;
}
