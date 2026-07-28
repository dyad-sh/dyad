import { z } from "zod";
import { RecordedActionSchema } from "./types";

/**
 * A finished recording that hasn't been turned into a file yet.
 *
 * The recorder stops with a draft, not a spec: the user reviews the steps, the
 * agent proposes assertions for them, and only an approval generates the
 * `.spec.ts`. Everything needed to emit that file deterministically lives here,
 * so the same draft produces the same spec wherever it is rendered.
 *
 * NOTE: this module is reachable from `src/ipc/types/recording.ts`, which the
 * preload bundle imports. Keep it dependency-free (zod only) and import it with
 * a RELATIVE path from there — the preload Vite target cannot resolve `@/...`.
 */

export const RECORDED_TEST_DRAFT_VERSION = 1 as const;

/** How the recording session was authenticated (drives the `signIn` fixture). */
export const RecordedTestAuthModeSchema = z.enum([
  "none",
  "neon-better-auth",
  "supabase-password",
]);
export type RecordedTestAuthMode = z.infer<typeof RecordedTestAuthModeSchema>;

export const RecordedTestDraftSchema = z.object({
  version: z.literal(RECORDED_TEST_DRAFT_VERSION),
  /** The Playwright test title, and the basis for the generated filename. */
  testName: z.string().min(1),
  /** `none` means the spec is emitted without `signIn(page)`. */
  authMode: RecordedTestAuthModeSchema,
  /** The collapsed interactions, in the order they will be replayed. */
  actions: z.array(RecordedActionSchema),
});
export type RecordedTestDraft = z.infer<typeof RecordedTestDraftSchema>;

/** Whether the spec should call — and import — the `signIn` fixture. */
export function draftIncludesSignIn(draft: {
  authMode: RecordedTestAuthMode;
}): boolean {
  return draft.authMode !== "none";
}
