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

/**
 * Recordings that have already produced a spec file, keyed by `draftId`.
 *
 * The two write paths can't see each other's parked draft: approving the
 * assertions card generates from the card's own copy (that copy is what makes
 * approval survive a restart), while the bar generates from the draft parked
 * here. Without this, saving from the bar and then approving a card built from
 * the same recording writes two near-identical specs.
 *
 * Not app-scoped, because `draftId` already is: a draft carries its identity
 * into the chat message, and matching on it alone keeps a deliberate
 * re-recording of the same flow — identical in every field but this one — a
 * recording of its own, entitled to its own file.
 */
const writtenByDraftId = new Map<string, string>();

/**
 * How many written recordings to remember per app. Only the most recent matter —
 * a card can be approved long after its recording, but not after twenty more.
 */
const MAX_REMEMBERED_WRITES = 20;

export function setRecordedTestDraft(
  appId: number,
  draft: RecordedTestDraft,
): void {
  draftsByAppId.set(appId, draft);
}

export function getRecordedTestDraft(appId: number): RecordedTestDraft | null {
  return draftsByAppId.get(appId) ?? null;
}

/**
 * Drop the parked draft. `only` scopes the clear to a specific recording: a card
 * hidden and approved after a *newer* recording was parked must not take that
 * newer draft down with it, leaving a recording the user can no longer save.
 */
export function clearRecordedTestDraft(
  appId: number,
  only?: RecordedTestDraft,
): void {
  if (only && draftsByAppId.get(appId)?.draftId !== only.draftId) return;
  draftsByAppId.delete(appId);
}

/** Remember the spec file this recording produced. */
export function markRecordedDraftWritten(
  draft: RecordedTestDraft,
  specPath: string,
): void {
  writtenByDraftId.set(draft.draftId, specPath);
  // Maps iterate in insertion order, so the first entry is the oldest.
  while (writtenByDraftId.size > MAX_REMEMBERED_WRITES) {
    const oldest = writtenByDraftId.keys().next().value;
    if (oldest === undefined) break;
    writtenByDraftId.delete(oldest);
  }
}

/** The spec this recording already produced, or null if it hasn't been written. */
export function getWrittenSpecForDraft(
  draft: RecordedTestDraft,
): string | null {
  return writtenByDraftId.get(draft.draftId) ?? null;
}

/**
 * Undo `markRecordedDraftWritten`, for a write that was rolled back. Without
 * this a retry would find the marker, latch approval against the deleted file,
 * and leave the user with a card pointing at a spec that isn't there.
 */
export function forgetRecordedDraftWrite(draft: RecordedTestDraft): void {
  writtenByDraftId.delete(draft.draftId);
}

/** Drop everything. For tests: these maps outlive a single handler harness. */
export function resetRecordedTestDrafts(): void {
  draftsByAppId.clear();
  writtenByDraftId.clear();
}
