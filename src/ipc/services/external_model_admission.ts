import { checkSubscriptionCredits } from "./codex_subscription_credit_check";

declare const admissionBrand: unique symbol;
/** Main-only, turn-scoped capability. Never serialize it into settings or IPC. */
export type ExternalModelAdmission = Readonly<{ [admissionBrand]: true }>;

const admissions = new WeakMap<
  ExternalModelAdmission,
  { apiKey: string; signal: AbortSignal }
>();

export async function checkExternalModelAdmission(
  apiKey: string,
  signal: AbortSignal,
): Promise<ExternalModelAdmission> {
  // The credit checker deliberately allows outages/timeouts. That decision is
  // admission too: do not re-check and reject the first request after acceptance.
  await checkSubscriptionCredits(apiKey, signal);
  signal.throwIfAborted();
  const admission = Object.freeze({}) as ExternalModelAdmission;
  admissions.set(admission, { apiKey, signal });
  return admission;
}

export function consumeExternalModelAdmission(
  admission: ExternalModelAdmission | undefined,
  apiKey: string,
): boolean {
  if (!admission) return false;
  const checked = admissions.get(admission);
  // Claim synchronously before any request await. Even a mismatched attempt
  // retires the capability; it cannot later be reused on the original account.
  admissions.delete(admission);
  return Boolean(
    checked && checked.apiKey === apiKey && !checked.signal.aborted,
  );
}
