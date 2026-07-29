import type { IdSource } from "@/state_machines/clock";

declare const requestIdBrand: unique symbol;
declare const messageIdBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

/** Stable identity for one logical completion-aware request. */
export type RequestId = string & { readonly [requestIdBrand]: true };

/** Delivery identity for one transport message. */
export type RequestMessageId = string & { readonly [messageIdBrand]: true };

/** Receiver deduplication identity, deliberately distinct from RequestId. */
export type RequestIdempotencyKey = string & {
  readonly [idempotencyKeyBrand]: true;
};

export interface RequestIdentity {
  readonly requestId: RequestId;
  readonly messageId: RequestMessageId;
  readonly idempotencyKey: RequestIdempotencyKey;
  readonly windowSessionId: string;
}

export function createRequestIdentity(
  ids: IdSource,
  windowSessionId: string,
): RequestIdentity {
  if (windowSessionId.length === 0) {
    throw new Error("A request requires a stable window-session identity");
  }
  return Object.freeze({
    requestId: ids.next("request") as RequestId,
    messageId: ids.next("request-message") as RequestMessageId,
    idempotencyKey: ids.next("request-idempotency") as RequestIdempotencyKey,
    windowSessionId,
  });
}
