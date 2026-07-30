import {
  prepareRequest,
  type AdmissionRefusal,
  type PrepareRequestOptions,
  type PreparedDispatchResult,
  type PreparedRequest,
  type PreparedRequestFailureClassification,
  type PreparedRequestScope,
} from "./prepared_request";
import type { RequestIdentity } from "./request_identity";
import type {
  ObservedRevisionToken,
  RemoteActorRef,
  RemoteActorView,
} from "./remote_client";
import type { IgnoreReason } from "@/state_machines/types";
import type { IdSource } from "@/state_machines/clock";
import { createRequestIdentity, type RequestId } from "./request_identity";
import type { ActorRuntimeMetadata } from "./definition";

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
  /**
   * Captures immutable request data synchronously. The same snapshot is used
   * for identity/fingerprinting and the later transport microtask.
   */
  readonly snapshotIntent: (intent: Intent) => Intent;
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
    signal: AbortSignal,
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
      const requestIntent = options.snapshotIntent(intent);
      const identity = options.prepareIdentity(requestIntent);
      return prepareRequest({
        identity,
        fingerprint: options.fingerprint(identity, requestIntent),
        scope: options.scope,
        retry: options.retry,
        classifyFailure: options.classifyFailure,
        reportError: options.reportError,
        dispatch: (stableIdentity, signal) =>
          options.dispatchRequest(stableIdentity, requestIntent, signal),
      });
    },
  };
}

export interface RemoteRequestIntent<Intent> {
  readonly intent: Intent;
  readonly expected?: ObservedRevisionToken;
}

export interface RemoteRequestActor<Input, Admission, Outcome, Refusal> {
  request(input: Input): PreparedRequest<Admission, Outcome, Refusal>;
}

export interface CreateRemoteRequestActorOptions<
  Input,
  Intent,
  State,
  Reason extends IgnoreReason,
  Admission,
  Outcome,
  Refusal,
> {
  readonly actor: RemoteActorRef<State, Intent, Reason>;
  readonly scope: PreparedRequestScope;
  readonly ids: IdSource;
  readonly windowSessionId: string;
  readonly snapshotInput: (input: Input) => Input;
  readonly prepareIntent: (
    input: Input,
    identity: RequestIdentity,
  ) => RemoteRequestIntent<Intent> | AdmissionRefusal<Refusal>;
  readonly fingerprint: (identity: RequestIdentity, input: Input) => string;
  readonly selectOutcome: (
    view: RemoteActorView<State>,
    requestId: RequestId,
    input: Input,
  ) => Outcome | undefined;
  /**
   * Observes request-owned snapshot changes without adding a second
   * domain-specific subscription. Used for legacy side effects that must span
   * the complete request lifetime.
   */
  readonly observeView?: (view: RemoteActorView<State>) => void;
  /**
   * Compatibility fallback for a remote owner that disposes after admission
   * without publishing a correlated outcome.
   */
  readonly outcomeOnUnavailable?: () => Outcome;
  readonly admissionFromReceipt: (
    receipt: Awaited<
      ReturnType<RemoteActorRef<State, Intent, Reason>["dispatch"]>
    >,
  ) => Admission | AdmissionRefusal<Refusal>;
  readonly isRefusal: (
    value: Admission | AdmissionRefusal<Refusal>,
  ) => value is AdmissionRefusal<Refusal>;
  readonly classifyFailure: CompletionAwareActorOptions<
    Input,
    Admission,
    Outcome,
    Refusal,
    never
  >["classifyFailure"];
  readonly retry: CompletionAwareActorOptions<
    Input,
    Admission,
    Outcome,
    Refusal,
    never
  >["retry"];
}

/**
 * Shared remote request bridge. It subscribes before dispatch, holds an
 * explicit lease through terminal delivery, and tears both down on client
 * detachment without cancelling authoritative main-owned work.
 */
export function createRemoteRequestActor<
  Input,
  Intent,
  State,
  Reason extends IgnoreReason,
  Admission,
  Outcome,
  Refusal,
>(
  options: CreateRemoteRequestActorOptions<
    Input,
    Intent,
    State,
    Reason,
    Admission,
    Outcome,
    Refusal
  >,
): RemoteRequestActor<Input, Admission, Outcome, Refusal> {
  return {
    request(input) {
      const preparedIntent = new WeakMap<
        RequestIdentity,
        RemoteRequestIntent<Intent> | AdmissionRefusal<Refusal>
      >();
      return createCompletionAwareActor<
        Input,
        Admission,
        Outcome,
        Refusal,
        never
      >({
        scope: options.scope,
        snapshotIntent: options.snapshotInput,
        prepareIdentity: () =>
          createRequestIdentity(options.ids, options.windowSessionId),
        fingerprint: (identity, requestInput) =>
          options.fingerprint(identity, requestInput),
        retry: options.retry,
        classifyFailure: options.classifyFailure,
        enqueue: () => {
          throw new Error("Remote completion-aware actors do not raw-enqueue");
        },
        dispatchRequest: async (identity, requestInput, signal) => {
          const lease = options.actor.retain();
          let unsubscribe: () => void = () => undefined;
          let unsubscribeOutcome: () => void = () => undefined;
          let resolveOutcome!: (outcome: Outcome) => void;
          const settled = new Promise<Outcome>((resolve) => {
            resolveOutcome = resolve;
          });
          let pendingOutcome:
            | {
                readonly outcome: Outcome;
                readonly actor: ActorRuntimeMetadata;
              }
            | undefined;
          let lastObservedView = options.actor.getView();
          let admitted = false;
          let done = false;
          const cleanup = () => {
            if (done) return;
            done = true;
            unsubscribe();
            unsubscribeOutcome();
            lease.release();
            signal.removeEventListener("abort", detach);
          };
          const complete = (outcome: Outcome) => {
            cleanup();
            resolveOutcome(outcome);
          };
          const observesCommittedActor = (
            view: RemoteActorView<State>,
            actor: ActorRuntimeMetadata,
          ) =>
            view.snapshot.kind === "available" &&
            view.snapshot.observedRevision.kind === "actor" &&
            view.snapshot.observedRevision.actorInstanceId ===
              actor.actorInstanceId &&
            view.snapshot.observedRevision.revision >= actor.snapshotRevision;
          const observe = (view: RemoteActorView<State>) => {
            if (lastObservedView === view) return;
            lastObservedView = view;
            options.observeView?.(view);
          };
          const inspect = (notify = false) => {
            const view = options.actor.getView();
            if (notify) observe(view);
            const outcome = options.selectOutcome(
              view,
              identity.requestId,
              requestInput,
            );
            if (outcome !== undefined) {
              complete(outcome);
              return;
            }
            if (
              pendingOutcome &&
              (view.snapshot.kind === "unavailable" ||
                observesCommittedActor(view, pendingOutcome.actor))
            ) {
              complete(pendingOutcome.outcome);
              return;
            }
            if (
              admitted &&
              view.snapshot.kind === "unavailable" &&
              view.connection === "ready" &&
              options.outcomeOnUnavailable
            ) {
              complete(options.outcomeOnUnavailable());
            }
          };
          const detach = () => {
            cleanup();
          };
          signal.addEventListener("abort", detach, { once: true });
          unsubscribeOutcome = options.actor.subscribeOperationOutcome(
            identity.requestId,
            (outcome, actor) => {
              const view = options.actor.getView();
              if (
                view.snapshot.kind === "unavailable" ||
                observesCommittedActor(view, actor)
              ) {
                observe(view);
                complete(outcome as Outcome);
                return;
              }
              pendingOutcome = { outcome: outcome as Outcome, actor };
            },
          );
          unsubscribe = options.actor.subscribe(() => inspect(true));
          inspect();
          try {
            await lease.ready;
            if (signal.aborted) throw signal.reason;
            const request =
              preparedIntent.get(identity) ??
              options.prepareIntent(requestInput, identity);
            preparedIntent.set(identity, request);
            if (!("intent" in request)) {
              cleanup();
              return request;
            }
            const receipt = await options.actor.dispatch(request.intent, {
              expected: request.expected,
              requestIdentity: identity,
            });
            const admission = options.admissionFromReceipt(receipt);
            if (options.isRefusal(admission)) {
              cleanup();
              return admission;
            }
            admitted = true;
            inspect();
            return {
              kind: "admitted",
              admission,
              disposition: "fresh",
              settled,
            };
          } catch (error) {
            cleanup();
            throw error;
          }
        },
      }).request(input);
    },
  };
}

export async function dispatchRemoteAdmissionOnly<
  State,
  Intent,
  Reason extends IgnoreReason,
>(
  actor: RemoteActorRef<State, Intent, Reason>,
  intent: Intent,
  expected?: ObservedRevisionToken,
) {
  const lease = actor.retain();
  try {
    await lease.ready;
    return await actor.dispatch(intent, { expected });
  } finally {
    lease.release();
  }
}
