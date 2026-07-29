import type { z } from "zod";
import type { DyadError } from "@/errors/dyad_error";
import type { RemoteMachineContract } from "./definition";
import type { ActorRuntimeMetadata, RemoteMachineSender } from "./definition";
import type { RequestIdentity } from "./request_identity";

export const DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES = 256 * 1_024;
export const DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES = 1_024 * 1_024;

export type RemoteAuthorizationPolicy = "public" | "required";

export type KeyIntentRelationship<Key, Intent> =
  | { readonly kind: "entity-relative" }
  | {
      readonly kind: "validate";
      readonly validate: (key: Key, intent: Intent) => boolean;
    };

export interface AdmittedIntentContext<Key, Intent> {
  readonly key: Key;
  readonly intent: Intent;
  readonly sender: {
    readonly windowSessionId: string;
  };
  /**
   * Present for completion-aware protocol-v1 requests. Main replaces the
   * renderer's local session value with the authenticated window session.
   */
  readonly requestIdentity?: RequestIdentity;
}

export type RemoteAuthorizationDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly error: DyadError };

export const allowRemoteAuthorization = (): RemoteAuthorizationDecision => ({
  kind: "allow",
});

export const denyRemoteAuthorization = (
  error: DyadError,
): RemoteAuthorizationDecision => ({ kind: "deny", error });

export interface SubscribeAuthorizationContext<Key> {
  readonly sender: RemoteMachineSender & {
    readonly windowSessionId: string;
  };
  /**
   * Decoded but deliberately not interned/canonicalized. Authorization must
   * not retain this value beyond the decision.
   */
  readonly key: Key;
  readonly encodedKey: unknown;
}

export interface DispatchAuthorizationContext<Key, Intent, State> {
  readonly sender: RemoteMachineSender & {
    readonly windowSessionId: string;
  };
  readonly key: Key;
  readonly intent: Intent;
  readonly currentState: State;
  readonly actor: ActorRuntimeMetadata;
  readonly expectedObservedRevision?: number;
}

export interface DomainRevisionContext<Key, Intent, State> {
  readonly name: string;
  readonly key: Key;
  readonly intent: Intent;
  readonly currentState: State;
}

export interface RemoteOperationAdmissionContext<
  Key,
  State,
  RemoteIntent,
  InternalEvent,
> {
  readonly key: Key;
  readonly intent: RemoteIntent;
  readonly event: InternalEvent;
  readonly currentState: State;
  readonly actor: ActorRuntimeMetadata;
  readonly sender: { readonly windowSessionId: string };
  readonly requestIdentity: RequestIdentity;
  readonly fingerprint: string;
}

export interface RemoteOperationAdmissionResult<EnqueueResult> {
  readonly disposition: "fresh" | "coalesced" | "replayed";
  readonly enqueueResult?: EnqueueResult;
  readonly operation: {
    readonly settled: Promise<{
      readonly invocationRef: unknown;
      readonly outcome: unknown;
    }>;
  };
}

export type ObservedRevisionPolicy =
  | { readonly kind: "none" }
  | { readonly kind: "actor"; readonly required: true }
  | {
      readonly kind: "domain";
      readonly name: string;
      readonly required: true;
    };

export type RetryPolicy =
  | { readonly kind: "none" }
  | {
      readonly kind: "stable-id";
      readonly identity: "message" | "request" | "domain";
      readonly receiverDeduplication: "required";
      readonly lifetime: "window-session" | "host-session";
    };

export interface RemoteIntentPolicy {
  readonly completion: "admission-only" | "tracked-completion";
  readonly observedRevision: ObservedRevisionPolicy;
  readonly retry: RetryPolicy;
  readonly acceptance:
    | "admission"
    | "durable-acceptance"
    | "completion"
    | "domain-event";
  readonly inputDisposition:
    | "preserve"
    | "preserve-until-accepted"
    | "preserve-until-completed";
}

export interface RemoteIntentRefusalMap {
  readonly authorization: "unauthorized";
  readonly keyIntentMismatch: "invalid-event" | "unauthorized";
  readonly actorChanged: "stale-actor";
  readonly revisionChanged: "revision-conflict";
  readonly transportClosed: "host-disposing";
}

export const PROTOCOL_V1_REFUSAL_MAP = {
  authorization: "unauthorized",
  keyIntentMismatch: "invalid-event",
  actorChanged: "stale-actor",
  revisionChanged: "revision-conflict",
  transportClosed: "host-disposing",
} as const satisfies RemoteIntentRefusalMap;

export interface RemoteIntentEnvelopeBudgets {
  readonly intentBytes: number;
  readonly snapshotBytes: number;
}

/**
 * Declarative contract layered beside the protocol-v1 runtime contract.
 *
 * PR2 intentionally does not consume this declaration at runtime. It separates
 * renderer intents from trusted events and gives conformance/report tooling a
 * complete policy surface without changing transport or actor admission.
 */
export interface RemoteIntentContract<
  Key,
  RendererIntent extends { readonly type: string },
  TrustedEvent,
  Snapshot,
> {
  readonly keyCodec: z.ZodType<Key>;
  readonly encodeKey: (key: Key) => unknown;
  readonly rendererIntentCodec: z.ZodType<RendererIntent>;
  readonly snapshotCodec: z.ZodType<Snapshot>;
  readonly toTrustedEvent: (
    context: AdmittedIntentContext<Key, RendererIntent>,
  ) => TrustedEvent;
  readonly authorization: {
    readonly subscribe: RemoteAuthorizationPolicy;
    readonly dispatch: RemoteAuthorizationPolicy;
  };
  readonly keyIntentRelationship: KeyIntentRelationship<Key, RendererIntent>;
  readonly intents: {
    readonly [Type in RendererIntent["type"]]: RemoteIntentPolicy;
  };
  readonly refusalMap: RemoteIntentRefusalMap;
  readonly budgets: RemoteIntentEnvelopeBudgets;
}

/**
 * Runtime-native remote boundary. Production definitions remain on the
 * protocol-v1 compatibility adapter until their domain-specific migrations.
 */
export interface RuntimeRemoteIntentContract<
  Key,
  State,
  RemoteIntent extends { readonly type: string },
  InternalEvent,
  Snapshot,
> extends Omit<
  RemoteIntentContract<Key, RemoteIntent, InternalEvent, Snapshot>,
  "toTrustedEvent" | "authorization"
> {
  readonly keyToString: (key: Key) => string;
  readonly toInternalEvent: (
    context: AdmittedIntentContext<Key, RemoteIntent>,
  ) => InternalEvent;
  readonly authorizeSubscribe: (
    context: SubscribeAuthorizationContext<Key>,
  ) => RemoteAuthorizationDecision | Promise<RemoteAuthorizationDecision>;
  readonly authorizeDispatch: (
    context: DispatchAuthorizationContext<Key, RemoteIntent, State>,
  ) => RemoteAuthorizationDecision | Promise<RemoteAuthorizationDecision>;
  readonly resolveDomainRevision?: (
    context: DomainRevisionContext<Key, RemoteIntent, State>,
  ) => number;
  readonly finalizeOperation?: (
    context: RemoteOperationAdmissionContext<
      Key,
      State,
      RemoteIntent,
      InternalEvent
    >,
    controls: {
      readonly assertFinalAdmission: () => void;
      readonly enqueue: () => unknown;
    },
  ) => RemoteOperationAdmissionResult<unknown>;
  readonly disposeWindowSession?: (windowSessionId: string) => void;
}

export function defineRuntimeRemoteIntentContract<
  Key,
  State,
  RemoteIntent extends { readonly type: string },
  InternalEvent,
  Snapshot,
>(
  contract: RuntimeRemoteIntentContract<
    Key,
    State,
    RemoteIntent,
    InternalEvent,
    Snapshot
  >,
): RuntimeRemoteIntentContract<
  Key,
  State,
  RemoteIntent,
  InternalEvent,
  Snapshot
> {
  const policies = contract.intents as Readonly<
    Record<string, RemoteIntentPolicy>
  >;
  const requiresDomainRevision = Object.values(policies).some(
    (policy) => policy.observedRevision.kind === "domain",
  );
  if (requiresDomainRevision && !contract.resolveDomainRevision) {
    throw new Error(
      "Native remote domain revision policies require resolveDomainRevision",
    );
  }
  return Object.freeze(contract);
}

export function defineRemoteIntentContract<
  Key,
  RendererIntent extends { readonly type: string },
  TrustedEvent,
  Snapshot,
>(
  contract: RemoteIntentContract<Key, RendererIntent, TrustedEvent, Snapshot>,
): RemoteIntentContract<Key, RendererIntent, TrustedEvent, Snapshot> {
  return Object.freeze(contract);
}

export function declareRemoteIntentContractForProtocolV1<
  Key,
  State,
  RendererIntent extends { readonly type: string },
  TrustedEvent,
  Snapshot,
>(
  legacy: Pick<
    RemoteMachineContract<Key, State, TrustedEvent, Snapshot>,
    "protocolVersion" | "keyCodec" | "encodeKey" | "snapshotCodec"
  >,
  declaration: Omit<
    RemoteIntentContract<Key, RendererIntent, TrustedEvent, Snapshot>,
    "keyCodec" | "encodeKey" | "snapshotCodec"
  >,
): RemoteIntentContract<Key, RendererIntent, TrustedEvent, Snapshot> {
  if (legacy.protocolVersion !== 1) {
    throw new Error(
      `Remote intent declarations currently preserve protocol v1 only; received v${legacy.protocolVersion}`,
    );
  }
  return defineRemoteIntentContract({
    ...declaration,
    keyCodec: legacy.keyCodec,
    encodeKey: legacy.encodeKey,
    snapshotCodec: legacy.snapshotCodec,
  });
}
