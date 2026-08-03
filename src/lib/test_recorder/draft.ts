import { z } from "zod";
import { RecordedActionSchema } from "./types";

/**
 * A finished recording that hasn't been turned into a file yet. The recorder
 * stops with a draft, not a spec: only an approval generates the `.spec.ts`.
 *
 * NOTE: reachable from `src/ipc/types/recording.ts`, which the preload bundle
 * imports. Keep it dependency-free (zod only) and import it with a RELATIVE path
 * from there — the preload Vite target cannot resolve `@/...`.
 */

export const RECORDED_TEST_DRAFT_VERSION = 1 as const;

/** How the recording session was authenticated (drives the `signIn` fixture). */
export const RecordedTestAuthModeSchema = z.enum([
  "none",
  "neon-better-auth",
  "supabase-password",
]);
export type RecordedTestAuthMode = z.infer<typeof RecordedTestAuthModeSchema>;

/**
 * Ceiling on the actions one draft may carry, mirroring the renderer's
 * `MAX_RECORDED_ENTRIES` buffer cap. Duplicated here rather than imported
 * because this module must stay dependency-free for the preload bundle — and
 * because the renderer's cap is not a guard at all from the main process's
 * point of view: this schema is the IPC boundary, and a forged
 * `recording:save-draft` would otherwise park an unbounded array.
 */
const MAX_DRAFT_ACTIONS = 5_000;

export const RecordedTestDraftSchema = z.object({
  version: z.literal(RECORDED_TEST_DRAFT_VERSION),
  /**
   * Names this recording, minted when the session stops.
   *
   * The two write paths generate from different copies of the draft — the bar
   * from the one parked in the main process, the assertions card from the one
   * embedded in its chat message — so they need a way to agree on "the same
   * recording". Comparing contents can't: recording the same flow twice on
   * purpose produces identical drafts, and the second would be mistaken for the
   * first and refused a file of its own.
   */
  draftId: z.string().min(1).max(128),
  /** The Playwright test title, and the basis for the generated filename. */
  testName: z.string().min(1),
  /** `none` means the spec is emitted without `signIn(page)`. */
  authMode: RecordedTestAuthModeSchema,
  /** The collapsed interactions, in the order they will be replayed. */
  actions: z.array(RecordedActionSchema).max(MAX_DRAFT_ACTIONS),
});
export type RecordedTestDraft = z.infer<typeof RecordedTestDraftSchema>;

export function draftIncludesSignIn(draft: {
  authMode: RecordedTestAuthMode;
}): boolean {
  return draft.authMode !== "none";
}
