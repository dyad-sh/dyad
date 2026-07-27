import type { AssistantMessage } from "@earendil-works/pi-ai";

import { DyadErrorKind } from "@/errors/dyad_error";

type ProviderFailure = Pick<AssistantMessage, "errorMessage" | "diagnostics">;

function toStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function findStatus(value: unknown, depth = 0): number | undefined {
  if (depth > 4 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const status = findStatus(item, depth + 1);
      if (status !== undefined) return status;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const status = toStatus(record[key]);
    if (status !== undefined) return status;
  }
  for (const key of ["details", "error", "response", "cause"]) {
    const status = findStatus(record[key], depth + 1);
    if (status !== undefined) return status;
  }
  return undefined;
}

export function classifyPiProviderError(
  failure: ProviderFailure,
): DyadErrorKind {
  const message = failure.errorMessage?.toLowerCase() ?? "";
  const status = findStatus(failure.diagnostics);

  if (
    status === 401 ||
    status === 403 ||
    /\b(401|403)\b|unauthori[sz]ed|authentication|api key.*(invalid|missing|rejected)|invalid api key/.test(
      message,
    )
  ) {
    return DyadErrorKind.Auth;
  }
  if (status === 429 || /\b429\b|rate.?limit|too many requests/.test(message)) {
    return DyadErrorKind.RateLimited;
  }
  if (
    /content.?filter|safety (system|policy)|refus(ed|al)|policy violation/.test(
      message,
    )
  ) {
    return DyadErrorKind.Precondition;
  }
  if (
    status === 400 ||
    status === 422 ||
    /\b(400|422)\b|invalid request|invalid argument|unsupported parameter|malformed/.test(
      message,
    )
  ) {
    return DyadErrorKind.Validation;
  }
  return DyadErrorKind.External;
}
