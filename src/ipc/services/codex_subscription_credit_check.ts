import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { fetchUserInfo, UserInfoApiError } from "./user_budget_service";

const logger = log.scope("codex_subscription_credit_check");
/** BYO only: reject confirmed denial, but let generation proceed on lookup failures. */
export async function checkSubscriptionCredits(
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  let info;
  try {
    signal?.throwIfAborted();
    info = await fetchUserInfo(apiKey, signal);
  } catch (error) {
    if (signal?.aborted)
      throw new DyadError(
        "Subscription request cancelled.",
        DyadErrorKind.UserCancelled,
      );
    if (error instanceof UserInfoApiError) {
      if (error.status === 401 || error.status === 403)
        throw new DyadError(
          "Your Dyad key was rejected. Update it in settings to use your subscription.",
          DyadErrorKind.Auth,
        );
      if (error.status === 402)
        throw new DyadError(
          "You're out of Dyad credits. Add credits to continue using your subscription.",
          DyadErrorKind.Precondition,
        );
    }
    // No upstream bodies, request objects, or credentials in logs.
    logger.warn(
      "BYO subscription credit check unavailable; allowing generation",
      { status: error instanceof UserInfoApiError ? error.status : undefined },
    );
    return;
  }
  if (signal?.aborted)
    throw new DyadError(
      "Subscription request cancelled.",
      DyadErrorKind.UserCancelled,
    );
  if (info.totalCredits <= info.usedCredits)
    throw new DyadError(
      "You're out of Dyad credits. Add credits to continue using your subscription.",
      DyadErrorKind.Precondition,
    );
}
