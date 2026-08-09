import type { RecordedTestDraft } from "@/lib/test_recorder/draft";

/**
 * The recording a user just finished and hasn't turned into a file yet, per app.
 *
 * Deliberately in-memory and short-lived: the draft only has to survive from
 * "Generate test proposal" in the recorder bar until the agent's
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
 * In-process cache of recordings that have already produced a spec file,
 * keyed by `draftId`.
 *
 * The two write paths can't see each other's parked draft: approving the
 * assertions card generates from the card's own copy (that copy is what makes
 * approval survive a restart), while the bar generates from the draft parked
 * here. Without this, saving from the bar and then approving a card built from
 * the same recording writes two near-identical specs.
 *
 * `draftId` alone identifies the recording — that is what keeps a deliberate
 * re-recording of the same flow, identical in every field but this one, a
 * recording of its own entitled to its own file. Generated specs also carry a
 * durable draft-id header; the approval handler scans for it when this cache
 * misses after a restart or eviction. The outer map exists only so this hot
 * path's eviction bound is per app.
 */
const writtenByAppId = new Map<number, Map<string, string>>();

/**
 * How many written recordings to cache per app before falling back to the
 * durable spec marker.
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
 * Drop the parked draft. `onlyDraftId` scopes the clear to a specific
 * recording: a card hidden and approved after a *newer* recording was parked
 * must not take that newer draft down with it, leaving a recording the user can
 * no longer save.
 */
export function clearRecordedTestDraft(
  appId: number,
  onlyDraftId?: string,
): void {
  if (onlyDraftId && draftsByAppId.get(appId)?.draftId !== onlyDraftId) return;
  draftsByAppId.delete(appId);
}

/** Remember the spec file this recording produced. */
export function markRecordedDraftWritten(
  appId: number,
  draft: RecordedTestDraft,
  specPath: string,
): void {
  let written = writtenByAppId.get(appId);
  if (!written) {
    written = new Map();
    writtenByAppId.set(appId, written);
  }
  written.set(draft.draftId, specPath);
  // Maps iterate in insertion order, so the first entry is the oldest.
  while (written.size > MAX_REMEMBERED_WRITES) {
    const oldest = written.keys().next().value;
    if (oldest === undefined) break;
    written.delete(oldest);
  }
}

/** The spec this recording already produced, or null if it hasn't been written. */
export function getWrittenSpecForDraft(
  appId: number,
  draft: RecordedTestDraft,
): string | null {
  return writtenByAppId.get(appId)?.get(draft.draftId) ?? null;
}

/**
 * Undo `markRecordedDraftWritten`, for a write that was rolled back. Without
 * this a retry would find the marker, latch approval against the deleted file,
 * and leave the user with a card pointing at a spec that isn't there.
 */
export function forgetRecordedDraftWrite(
  appId: number,
  draft: RecordedTestDraft,
): void {
  writtenByAppId.get(appId)?.delete(draft.draftId);
}

/** Drop everything. For tests: these maps outlive a single handler harness. */
export function resetRecordedTestDrafts(): void {
  draftsByAppId.clear();
  writtenByAppId.clear();
}
