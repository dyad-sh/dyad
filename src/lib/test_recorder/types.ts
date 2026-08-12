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
 * A host that cannot be reached, so resolving against it proves whether a
 * candidate path stays on whatever origin Playwright resolves it against.
 */
const NAVIGATE_BASE = "http://dyad.invalid";

/**
 * Whether `page.goto(value)` would stay inside the recorded app.
 *
 * Decided by resolution rather than by inspecting the string: `//host` and
 * `/\host` both open with a `/` and look app-relative, but WHATWG URL treats a
 * backslash as a separator for special schemes, so `/\evil.example` resolves to
 * `http://evil.example/` just as the protocol-relative form does. Resolving
 * against a known base and comparing origins catches both, and anything else
 * that normalizes off-origin.
 */
function isAppRelativePath(value: string): boolean {
  // Decided on the string a URL parser will actually see. WHATWG URL deletes
  // every tab, LF and CR from its input before parsing anything, so
  // `"/\t/dyad.invalid/x"` is parsed as the authority-relative
  // `"//dyad.invalid/x"` — reading the raw second character here would find the
  // tab, pass the structural check below, and then resolve onto the sentinel
  // base and compare equal. Playwright resolves the same string against the
  // real preview and leaves the app.
  const normalized = value.replace(/[\t\n\r]/g, "");
  if (!normalized.startsWith("/")) return false;
  // An authority-relative path is off-origin by construction, and comparing
  // resolved origins can't see it: `//dyad.invalid/x` resolves *onto* the
  // sentinel base and compares equal, while Playwright would resolve it against
  // the real preview and leave the app. Both separators, since WHATWG URL
  // treats them alike for special schemes.
  if (normalized[1] === "/" || normalized[1] === "\\") return false;
  try {
    return new URL(normalized, NAVIGATE_BASE).origin === NAVIGATE_BASE;
  } catch {
    return false;
  }
}

/**
 * Constrained to an app-relative path so the previewed app can't inject
 * `page.goto("https://…")` into the spec written to the user's repo.
 */
const NavigatePathSchema = z
  .string()
  .max(MAX_PATH_LEN)
  .refine(isAppRelativePath, {
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
  // Synthesized in the renderer when the user navigates from Dyad's own chrome:
  // the preview address bar and routes dropdown for `navigate`, its back and
  // forward buttons for the other two. Routing the app does on its own is not
  // recorded — the step that triggered it already is.
  z.object({
    kind: z.literal("navigate"),
    path: NavigatePathSchema,
    /**
     * This is the route the session opened on, not a step the user took during
     * it. The recorder seeds one when recording starts somewhere other than the
     * app root, so replay opens where the flow actually began.
     *
     * Codegen is the only reader, and it only decides whether to emit the
     * leading `page.goto("/")` — so a previewed app forging the flag on its own
     * `navigate` costs nothing beyond a spec that skips one navigation.
     */
    initial: z.literal(true).optional(),
  }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("forward") }),
]);
export type RecordedAction = z.infer<typeof RecordedActionSchema>;

/**
 * One observation from the recorder client, before `collapseActions` folds the
 * stream into the actions a spec replays.
 *
 * Deliberately just the action: click→dblclick merging is decided structurally
 * (the gesture's own leading click is the immediately preceding entry), not by
 * a time window, so there is no timestamp for anything to read. Adding one back
 * would be state the recorder carries for nobody.
 */
export interface RecordedEntry {
  action: RecordedAction;
}

/** Validate an untrusted `dyad-recorder-action` payload; null when malformed. */
export function parseRecorderAction(data: unknown): RecordedAction | null {
  const result = RecordedActionSchema.safeParse(data);
  return result.success ? result.data : null;
}
