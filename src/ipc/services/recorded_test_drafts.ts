import type { RecordedTestDraft } from "@/lib/test_recorder/draft";

/**
 * The recording a user just finished and hasn't turned into a file yet, per app.
 *
 * Deliberately in-memory and short-lived: the draft only has to survive from
 * "Generate assertions" in the recorder bar until the agent's
 * `generate_test_assertions` tool runs, seconds later. From that point the
 * proposal's payload carries its own copy of the draft inside the chat message,
 * which is what makes approving durable — a restart loses the pending draft, not
 * a proposal the user can still act on.
 *
 * One draft per app: the recorder allows a single session per app, so a new
 * recording replaces whatever was waiting.
 */
const draftsByAppId = new Map<number, RecordedTestDraft>();

export function setRecordedTestDraft(
  appId: number,
  draft: RecordedTestDraft,
): void {
  draftsByAppId.set(appId, draft);
}

export function getRecordedTestDraft(appId: number): RecordedTestDraft | null {
  return draftsByAppId.get(appId) ?? null;
}

export function clearRecordedTestDraft(appId: number): void {
  draftsByAppId.delete(appId);
}
