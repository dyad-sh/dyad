type ReviewContinuation = () => Promise<void>;

interface PendingReviewContinuation {
  /**
   * The remediation-bound reviewer thread the continuation is meant to
   * settle once the step-limited remediation resumes. Captured so the
   * renderer can `skipReviewAutoFix`-settle the thread if the continuation
   * is abandoned (e.g. an unrelated turn is cancelled while it is pending).
   */
  threadId: string | undefined;
  continuation: ReviewContinuation;
}

const pendingReviewContinuations = new Map<number, PendingReviewContinuation>();

export function setPendingReviewContinuation(
  chatId: number,
  threadId: string | undefined,
  continuation: ReviewContinuation,
): void {
  pendingReviewContinuations.set(chatId, { threadId, continuation });
}

export function hasPendingReviewContinuation(chatId: number): boolean {
  return pendingReviewContinuations.has(chatId);
}

/**
 * Resume the review flow after a step-limited remediation turn eventually
 * completes. Delete before invoking so duplicate stream completion events
 * cannot start two verification reviews.
 */
export async function resumePendingReviewContinuation(
  chatId: number,
): Promise<boolean> {
  const entry = pendingReviewContinuations.get(chatId);
  if (!entry) return false;

  pendingReviewContinuations.delete(chatId);
  await entry.continuation();
  return true;
}

/**
 * Drop a pending review continuation without running it. Returns the
 * remediation-bound thread id (if any) so the caller can settle the
 * in-flight review thread the continuation was going to verify.
 */
export function clearPendingReviewContinuation(
  chatId: number,
): string | undefined {
  const entry = pendingReviewContinuations.get(chatId);
  pendingReviewContinuations.delete(chatId);
  return entry?.threadId;
}
