import { z } from "zod";

/**
 * Shared model for the preview test recorder. The injected recorder client
 * (`worker/dyad-recorder-client.js`) posts `RecordedAction`s to the renderer.
 * These are validated at the postMessage boundary with `parseRecorderAction`
 * because the payload originates in the previewed app's frame.
 */

export const LocatorKindSchema = z.enum([
  "testid",
  "role",
  "placeholder",
  "label",
  "text",
  "css",
]);
export type LocatorKind = z.infer<typeof LocatorKindSchema>;

/**
 * Bounds for every free-form string crossing the postMessage boundary. The
 * previewed app is untrusted, so an unbounded schema lets it park megabytes per
 * action in renderer memory. Far above anything a real recording reaches.
 */
const MAX_LOCATOR_LEN = 1_024;
const MAX_VALUE_LEN = 10_000;
const MAX_KEY_LEN = 64;
const MAX_SELECT_VALUES = 100;
const MAX_PATH_LEN = 2_048;

export const LocatorDescriptorSchema = z.object({
  kind: LocatorKindSchema,
  value: z.string().max(MAX_LOCATOR_LEN),
  /** Accessible name, only for `kind: "role"`. */
  name: z.string().max(MAX_LOCATOR_LEN).optional(),
  /**
   * Match the name/text exactly instead of Playwright's default case-insensitive
   * substring. The recorder checks uniqueness with `===`, so the generated
   * locator must hold itself to the same standard or replay can match more
   * elements than the recorder saw.
   */
  exact: z.boolean().optional(),
  /** Zero-based index when the locator matches multiple elements. */
  nth: z.number().int().nonnegative().optional(),
});
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;

/**
 * Constrained to an app-relative path so the previewed app can't inject
 * `page.goto("https://…")` into the spec written to the user's repo. `//host` is
 * rejected alongside absolute URLs: a protocol-relative path is off-origin too
 * once Playwright resolves it against the base URL.
 */
const NavigatePathSchema = z
  .string()
  .max(MAX_PATH_LEN)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "navigate path must be app-relative",
  });

export const RecordedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), locator: LocatorDescriptorSchema }),
  z.object({ kind: z.literal("dblclick"), locator: LocatorDescriptorSchema }),
  z.object({
    kind: z.literal("fill"),
    locator: LocatorDescriptorSchema,
    value: z.string().max(MAX_VALUE_LEN),
  }),
  z.object({
    kind: z.literal("press"),
    // Absent for a page-level shortcut; those replay via `page.keyboard.press`.
    locator: LocatorDescriptorSchema.optional(),
    key: z.string().max(MAX_KEY_LEN),
  }),
  z.object({ kind: z.literal("check"), locator: LocatorDescriptorSchema }),
  z.object({ kind: z.literal("uncheck"), locator: LocatorDescriptorSchema }),
  z.object({
    kind: z.literal("select"),
    locator: LocatorDescriptorSchema,
    values: z.array(z.string().max(MAX_VALUE_LEN)).max(MAX_SELECT_VALUES),
  }),
  // Synthesized in the renderer from the preview's pushState/replaceState.
  z.object({ kind: z.literal("navigate"), path: NavigatePathSchema }),
]);
export type RecordedAction = z.infer<typeof RecordedActionSchema>;

export interface RecordedEntry {
  action: RecordedAction;
  /** Epoch ms the action was observed; used to merge click→dblclick. */
  at: number;
}

/** Validate an untrusted `dyad-recorder-action` payload; null when malformed. */
export function parseRecorderAction(data: unknown): RecordedAction | null {
  const result = RecordedActionSchema.safeParse(data);
  return result.success ? result.data : null;
}
