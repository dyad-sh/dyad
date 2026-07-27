import { z } from "zod";

/**
 * Data model for the reviewable "Add assertions with AI" flow.
 *
 * A proposal is a flat, ordered list of plan items — the test's steps and the
 * proposed assertions interleaved. The user edits/removes/reorders that list in
 * the chat card, and on approval it is spliced back into the spec file by
 * `spec_edit.ts`.
 *
 * NOTE: this module is reachable from `src/ipc/types/tests.ts`, which the
 * preload bundle imports. Keep it dependency-free (zod only) and import it with
 * a RELATIVE path from there — the preload Vite target cannot resolve `@/...`.
 */

export const AssertionOriginSchema = z.enum(["model", "user"]);
export type AssertionOrigin = z.infer<typeof AssertionOriginSchema>;

export const ProposedAssertionSchema = z.object({
  /** Stable client-side id; survives edits and reordering. */
  id: z.string().min(1),
  /** The assertion in one plain-English sentence — what the card shows. */
  text: z.string(),
  /** The Playwright statement, or null for a user-authored assertion with no code yet. */
  code: z.string().nullable(),
  /**
   * True when `code` no longer corresponds to `text` — the user edited the
   * sentence or authored the assertion. The apply handler re-synthesizes the
   * code for exactly these, leaving everything else deterministic.
   */
  needsCode: z.boolean(),
  origin: AssertionOriginSchema,
});
export type ProposedAssertion = z.infer<typeof ProposedAssertionSchema>;

export const AssertionPlanItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("step"),
    /** Index into `ParsedSpec.bodyStatements` — the statement this row renders. */
    stepIndex: z.number().int().nonnegative(),
    /** The step in one plain-English sentence. */
    text: z.string(),
  }),
  ProposedAssertionSchema.extend({ kind: z.literal("assertion") }),
]);
export type AssertionPlanItem = z.infer<typeof AssertionPlanItemSchema>;

export const AssertionProposalPayloadSchema = z.object({
  version: z.literal(1),
  appId: z.number().int(),
  /** App-relative spec path, e.g. "e2e-tests/recorded-add-item.spec.ts". */
  specPath: z.string(),
  testTitle: z.string(),
  /** sha256 of the spec source this proposal was computed from. */
  specHash: z.string(),
  /** Steps and assertions interleaved, in the order they will be written. */
  items: z.array(AssertionPlanItemSchema),
});
export type AssertionProposalPayload = z.infer<
  typeof AssertionProposalPayloadSchema
>;

export const ASSERTION_PROPOSAL_VERSION = 1 as const;

/** Narrowing helper — `kind` discriminates, but this reads better at call sites. */
export function isAssertionItem(
  item: AssertionPlanItem,
): item is Extract<AssertionPlanItem, { kind: "assertion" }> {
  return item.kind === "assertion";
}

export function countAssertions(items: AssertionPlanItem[]): number {
  return items.filter(isAssertionItem).length;
}

/** Strip `await ` / trailing `;` so a raw statement can stand in for a sentence. */
function statementFallbackText(statement: string): string {
  return statement.replace(/^await\s+/, "").replace(/;\s*$/, "");
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
 * what lets `renderSpec` rebuild the file. Assertions whose `afterStep` is out
 * of range are DROPPED (and counted), never clamped: a hallucinated index means
 * the model wasn't looking at the statement we think it was, and clamping would
 * silently attach the assertion to the wrong step.
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

  // Bucket assertions by the step they follow. -1 is the "before everything"
  // bucket. Model order is preserved within each bucket.
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
      text:
        descriptionByIndex.get(stepIndex) ?? statementFallbackText(statement),
    });
    for (const raw of byAfterStep.get(stepIndex) ?? []) items.push(toItem(raw));
  });

  return { items, droppedAssertionCount };
}

/**
 * Move one assertion within the plan. Mirrors `reorderVisibleChatIds`
 * (`src/components/chat/ChatTabs.tsx`): remove at `fromIndex`, then insert at
 * `toIndex` interpreted in the post-removal array.
 *
 * Returns the SAME array reference on any no-op (equal indices, out of range, or
 * `items[fromIndex]` is a step) so callers can cheaply skip a re-render.
 *
 * Moving a single element never changes the relative order of the others, so
 * "each step appears exactly once, in ascending `stepIndex` order" is preserved
 * by construction — no validation needed in the drag handler.
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
