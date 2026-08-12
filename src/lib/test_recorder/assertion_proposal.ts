import { z } from "zod";
import { RecordedTestDraftSchema } from "./draft";

/**
 * Data model for the reviewable test proposal: a flat, ordered list
 * of the recorded test's steps and the proposed assertions interleaved.
 *
 * NOTE: reachable from `src/ipc/types/tests.ts`, which the preload bundle
 * imports. Keep it dependency-free (zod only) and import it with a RELATIVE path
 * from there — the preload Vite target cannot resolve `@/...`.
 */

export const AssertionOriginSchema = z.enum(["model", "user"]);
export type AssertionOrigin = z.infer<typeof AssertionOriginSchema>;

/**
 * Bounds on an approved plan, mirroring the ones `RecordedTestDraftSchema` and
 * `RecordedActionSchema` already put on a recording.
 *
 * The plan arrives from the renderer and is both persisted verbatim into the
 * chat message and fed to the assertion-code model, so an oversized one bloats
 * chat history and a model request at once. Every limit here is far above any
 * plan a user could assemble by hand.
 */
export const MAX_PLAN_ITEMS = 10_000;
/** A UUID today; sized so a different id scheme doesn't have to revisit this. */
export const MAX_ASSERTION_ID_LENGTH = 128;
/**
 * Ceiling the schema enforces on a step row.
 *
 * Deliberately far above what `buildPlanItems` produces: it truncates to
 * `MAX_STEP_TEXT_DISPLAY_LENGTH` first, so the bound is slack rather than
 * something a real plan can reach. Sizing it to the *untruncated* worst case
 * was not possible — step text falls back to the generated statement, and
 * `actionToCodeLine` JSON-escapes a `fill` value of up to `MAX_VALUE_LEN`
 * (10,000) characters, which expands sixfold when every one of them is a
 * control character. A recording well inside its own limits could therefore
 * fail this one and take the whole proposal down with it.
 */
export const MAX_STEP_TEXT_LENGTH = 20_000;
/**
 * Longest step row a plan actually carries.
 *
 * Step text is display-only — `recordedBodyStatements` regenerates the spec
 * from the draft, never from these strings — so truncating costs nothing that
 * is read back, and keeps one long recorded `fill` from parking tens of
 * kilobytes in chat history and in the assertion-code request.
 */
export const MAX_STEP_TEXT_DISPLAY_LENGTH = 2_000;
/** One plain-English sentence, model- or user-authored. */
export const MAX_ASSERTION_TEXT_LENGTH = 2_000;
/** A Playwright `expect(...)` line, which may carry a long locator. */
export const MAX_ASSERTION_CODE_LENGTH = 10_000;

export const ProposedAssertionSchema = z.object({
  /** Stable client-side id; survives edits and reordering. */
  id: z.string().min(1).max(MAX_ASSERTION_ID_LENGTH),
  text: z.string().max(MAX_ASSERTION_TEXT_LENGTH),
  /** Null for a user-authored assertion with no code yet. */
  code: z.string().max(MAX_ASSERTION_CODE_LENGTH).nullable(),
  /**
   * `code` no longer corresponds to `text`. The apply handler re-synthesizes the
   * code for exactly these, leaving everything else deterministic.
   */
  needsCode: z.boolean(),
  origin: AssertionOriginSchema,
});
export type ProposedAssertion = z.infer<typeof ProposedAssertionSchema>;

export const AssertionPlanItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("step"),
    /** Index into `recordedBodyStatements(draft)` — the statement this row renders. */
    stepIndex: z.number().int().nonnegative(),
    text: z.string().max(MAX_STEP_TEXT_LENGTH),
  }),
  ProposedAssertionSchema.extend({ kind: z.literal("assertion") }),
]);
export type AssertionPlanItem = z.infer<typeof AssertionPlanItemSchema>;

export const ASSERTION_PROPOSAL_VERSION = 2 as const;

export const AssertionProposalPayloadSchema = z.object({
  version: z.literal(ASSERTION_PROPOSAL_VERSION),
  appId: z.number().int(),
  /** The recording the plan describes; the spec is generated from it on approve. */
  draft: RecordedTestDraftSchema,
  testTitle: z.string(),
  /** Null until the user approves — the name is only claimed at write time. */
  specPath: z.string().nullable(),
  /** Steps and assertions interleaved, in the order they will be written. */
  items: z.array(AssertionPlanItemSchema).max(MAX_PLAN_ITEMS),
});
export type AssertionProposalPayload = z.infer<
  typeof AssertionProposalPayloadSchema
>;

export function isAssertionItem(
  item: AssertionPlanItem,
): item is Extract<AssertionPlanItem, { kind: "assertion" }> {
  return item.kind === "assertion";
}

export function countAssertions(items: AssertionPlanItem[]): number {
  return items.filter(isAssertionItem).length;
}

function statementFallbackText(statement: string): string {
  return statement.replace(/^await\s+/, "").replace(/;\s*$/, "");
}

/**
 * Bound a step row to something a card can render and the schema will accept.
 * Applied to the model's description and to the statement fallback alike —
 * neither is read back, and either can arrive longer than a row should be.
 */
function truncateStepText(text: string): string {
  if (text.length <= MAX_STEP_TEXT_DISPLAY_LENGTH) return text;
  return `${text.slice(0, MAX_STEP_TEXT_DISPLAY_LENGTH - 1)}…`;
}

export interface RawStepDescription {
  index: number;
  text: string;
}

export interface RawProposedAssertion {
  /** 0-based statement index to insert after; -1 places it before the first step. */
  afterStep: number;
  text: string;
  code: string;
}

/**
 * Normalize one raw model response into the flat plan the card renders.
 *
 * Every statement becomes exactly one `step` item, in order — that invariant is
 * what lets the approval rebuild the spec. Assertions whose `afterStep` is out
 * of range are DROPPED (and counted), never clamped: clamping would silently
 * attach the assertion to the wrong step.
 */
export function buildPlanItems({
  bodyStatements,
  stepDescriptions,
  assertions,
  newId,
}: {
  bodyStatements: string[];
  stepDescriptions: RawStepDescription[];
  assertions: RawProposedAssertion[];
  newId: () => string;
}): { items: AssertionPlanItem[]; droppedAssertionCount: number } {
  // First description wins, so a duplicated index can't clobber an earlier one.
  const descriptionByIndex = new Map<number, string>();
  for (const { index, text } of stepDescriptions) {
    const trimmed = text.trim();
    if (!trimmed || descriptionByIndex.has(index)) continue;
    descriptionByIndex.set(index, trimmed);
  }

  // Bucket by the step each follows; -1 is "before everything".
  const byAfterStep = new Map<number, RawProposedAssertion[]>();
  let droppedAssertionCount = 0;
  for (const assertion of assertions) {
    const after = assertion.afterStep;
    if (
      !Number.isInteger(after) ||
      after < -1 ||
      after >= bodyStatements.length
    ) {
      droppedAssertionCount++;
      continue;
    }
    const bucket = byAfterStep.get(after);
    if (bucket) bucket.push(assertion);
    else byAfterStep.set(after, [assertion]);
  }

  const toItem = (raw: RawProposedAssertion): AssertionPlanItem => ({
    kind: "assertion",
    id: newId(),
    text: raw.text.trim(),
    code: raw.code,
    needsCode: false,
    origin: "model",
  });

  const items: AssertionPlanItem[] = [];
  for (const raw of byAfterStep.get(-1) ?? []) items.push(toItem(raw));
  bodyStatements.forEach((statement, stepIndex) => {
    items.push({
      kind: "step",
      stepIndex,
      text: truncateStepText(
        descriptionByIndex.get(stepIndex) ?? statementFallbackText(statement),
      ),
    });
    for (const raw of byAfterStep.get(stepIndex) ?? []) items.push(toItem(raw));
  });

  return { items, droppedAssertionCount };
}

/**
 * Move one assertion within the plan. Mirrors `reorderVisibleChatIds`
 * (`src/components/chat/ChatTabs.tsx`): remove at `fromIndex`, then insert at
 * `toIndex` interpreted in the post-removal array. Returns the SAME array
 * reference on any no-op so callers can cheaply skip a re-render.
 */
export function moveAssertion(
  items: AssertionPlanItem[],
  fromIndex: number,
  toIndex: number,
): AssertionPlanItem[] {
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex >= items.length) return items;
  if (!isAssertionItem(items[fromIndex])) return items;

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
