type ReviewContinuation = () => Promise<void>;

const pendingReviewContinuations = new Map<number, ReviewContinuation>();

export function setPendingReviewContinuation(
  chatId: number,
  continuation: ReviewContinuation,
): void {
  pendingReviewContinuations.set(chatId, continuation);
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
  const continuation = pendingReviewContinuations.get(chatId);
  if (!continuation) return false;

  pendingReviewContinuations.delete(chatId);
  await continuation();
  return true;
}

export function clearPendingReviewContinuation(chatId: number): void {
  pendingReviewContinuations.delete(chatId);
}
