import { DyadError, DyadErrorKind } from "../errors/dyad_error";

export const SUBSCRIPTION_BILLING_ERRORS = {
  OUT_OF_CREDITS: {
    title: "You’re out of AI credits",
    description: "Add credits to continue using Pro features.",
    message:
      "You're out of Dyad credits. Add credits to continue using Pro features.",
    action: "Get more credits",
    url: "https://academy.dyad.sh/subscription",
  },
  KEY_REJECTED: {
    title: "Your Dyad Pro key was rejected",
    description: "Get your current Pro key.",
    message: "Your Dyad Pro key was rejected. Get your current Pro key.",
    action: "Open membership portal",
    url: "https://academy.dyad.sh",
  },
} as const;

type SubscriptionBillingErrorCode = keyof typeof SUBSCRIPTION_BILLING_ERRORS;

export class SubscriptionBillingError extends DyadError {
  constructor(readonly code: SubscriptionBillingErrorCode) {
    super(
      SUBSCRIPTION_BILLING_ERRORS[code].message,
      code === "KEY_REJECTED" ? DyadErrorKind.Auth : DyadErrorKind.Precondition,
    );
  }

  // Chat error state uses strings, like the existing quota error envelopes.
  serialize(): string {
    return JSON.stringify({
      type: "SUBSCRIPTION_BILLING_ERROR",
      code: this.code,
    });
  }
}

export function parseSubscriptionBillingError(error: string) {
  try {
    const parsed: unknown = JSON.parse(error);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      parsed.type === "SUBSCRIPTION_BILLING_ERROR" &&
      "code" in parsed &&
      (parsed.code === "OUT_OF_CREDITS" || parsed.code === "KEY_REJECTED")
    ) {
      return SUBSCRIPTION_BILLING_ERRORS[parsed.code];
    }
  } catch {
    // Ordinary chat errors are plain text.
  }
  return null;
}
