import {
  prepareRequest,
  type PrepareRequestOptions,
  type PreparedDispatchResult,
  type PreparedRequest,
  type PreparedRequestFailureClassification,
  type PreparedRequestScope,
} from "./prepared_request";
import type { RequestIdentity } from "./request_identity";

export interface CompletionAwareActor<
  Intent,
  Admission,
  Outcome,
  Refusal,
  EnqueueResult,
> {
  /** Admission/enqueue only. It never represents domain completion. */
  enqueue(intent: Intent): EnqueueResult;
  /** Creates the client handle synchronously before crossing the boundary. */
  request(intent: Intent): PreparedRequest<Admission, Outcome, Refusal>;
}

export interface CompletionAwareActorOptions<
  Intent,
  Admission,
  Outcome,
  Refusal,
  EnqueueResult,
> {
  readonly scope: PreparedRequestScope;
  readonly prepareIdentity: (intent: Intent) => RequestIdentity;
  readonly fingerprint: (identity: RequestIdentity, intent: Intent) => string;
  readonly retry: PrepareRequestOptions<Admission, Outcome, Refusal>["retry"];
  readonly classifyFailure: (
    error: unknown,
  ) => PreparedRequestFailureClassification;
  readonly reportError?: (error: unknown) => void;
  readonly enqueue: (intent: Intent) => EnqueueResult;
  readonly dispatchRequest: (
    identity: RequestIdentity,
    intent: Intent,
  ) => Promise<PreparedDispatchResult<Admission, Outcome, Refusal>>;
}

/**
 * Explicit compatibility boundary: existing raw dispatch can back enqueue,
 * while completion-aware consumers opt into request().
 */
export function createCompletionAwareActor<
  Intent,
  Admission,
  Outcome,
  Refusal,
  EnqueueResult,
>(
  options: CompletionAwareActorOptions<
    Intent,
    Admission,
    Outcome,
    Refusal,
    EnqueueResult
  >,
): CompletionAwareActor<Intent, Admission, Outcome, Refusal, EnqueueResult> {
  return {
    enqueue: options.enqueue,
    request(intent) {
      const identity = options.prepareIdentity(intent);
      return prepareRequest({
        identity,
        fingerprint: options.fingerprint(identity, intent),
        scope: options.scope,
        retry: options.retry,
        classifyFailure: options.classifyFailure,
        reportError: options.reportError,
        dispatch: (stableIdentity) =>
          options.dispatchRequest(stableIdentity, intent),
      });
    },
  };
}
