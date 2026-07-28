import { serialize } from "node:v8";
import type { z } from "zod";
import type {
  RemoteIntentEnvelopeBudgets,
  RemoteIntentPolicy,
} from "../remote_intent_contract";

export type ConformanceTier = "T0" | "T1" | "T2" | "T3" | "T4";

export type HistoricalFailureShape =
  | "construction-disposal-recreation"
  | "post-authorization-actor-window-change"
  | "unsubscribe-during-bootstrap"
  | "refresh-acquires-ownership"
  | "unresolved-receipt-under-pressure"
  | "request-runtime-identity-alias"
  | "disposal-with-unresolved-work"
  | "ingress-through-deletion-fence"
  | "late-producer-actor-recreation"
  | "ui-mutation-before-authoritative-admission"
  | "activation-reentry"
  | "retention-deadline-refresh"
  | "same-id-payload-conflict"
  | "stale-release"
  | "bootstrap-generation-regression"
  | "delivery-projection-divergence"
  | "error-classification-collapse"
  | "abort-terminal-settlement";

export const REQUIRED_HISTORICAL_FAILURE_SHAPES = [
  "construction-disposal-recreation",
  "post-authorization-actor-window-change",
  "unsubscribe-during-bootstrap",
  "refresh-acquires-ownership",
  "unresolved-receipt-under-pressure",
  "request-runtime-identity-alias",
  "disposal-with-unresolved-work",
  "ingress-through-deletion-fence",
  "late-producer-actor-recreation",
  "ui-mutation-before-authoritative-admission",
] as const satisfies readonly HistoricalFailureShape[];

export interface MachineConformance<
  StateVariant extends string = string,
  EventVariant extends string = string,
> {
  readonly machineId: string;
  readonly stateVariants: readonly StateVariant[];
  readonly eventVariants: readonly EventVariant[];
  readonly exclusions: readonly {
    readonly tier: ConformanceTier;
    readonly reason: string;
  }[];
  readonly tiers: readonly ConformanceTier[];
  readonly invariants: readonly {
    readonly id: string;
    readonly description: string;
  }[];
  readonly representativeCapabilities: Readonly<
    Record<string, readonly EventVariant[]>
  >;
  readonly representativeIntents: Readonly<
    Partial<Record<EventVariant, () => unknown>>
  >;
  readonly historicalFailureShapes: readonly HistoricalFailureShape[];
}

function unique(values: readonly string[], label: string): void {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `${label} contains duplicates: ${[...new Set(duplicates)]}`,
    );
  }
}

export function defineMachineConformance<
  const StateVariants extends readonly string[],
  const EventVariants extends readonly string[],
>(
  conformance: Omit<
    MachineConformance<StateVariants[number], NoInfer<EventVariants[number]>>,
    "stateVariants" | "eventVariants"
  > & {
    readonly stateVariants: StateVariants;
    readonly eventVariants: EventVariants;
  },
): MachineConformance<StateVariants[number], EventVariants[number]> {
  if (conformance.stateVariants.length === 0) {
    throw new Error(`${conformance.machineId}: state inventory is empty`);
  }
  if (conformance.eventVariants.length === 0) {
    throw new Error(`${conformance.machineId}: event inventory is empty`);
  }
  if (conformance.tiers.length === 0) {
    throw new Error(`${conformance.machineId}: no conformance tier applies`);
  }
  unique(conformance.stateVariants, `${conformance.machineId} states`);
  unique(conformance.eventVariants, `${conformance.machineId} events`);
  unique(conformance.tiers, `${conformance.machineId} tiers`);
  unique(
    conformance.historicalFailureShapes,
    `${conformance.machineId} failure shapes`,
  );
  const eventVariants = new Set<string>(conformance.eventVariants);
  for (const [capability, events] of Object.entries(
    conformance.representativeCapabilities,
  )) {
    for (const event of events) {
      if (!eventVariants.has(event)) {
        throw new Error(
          `${conformance.machineId}: capability ${capability} references unknown event ${event}`,
        );
      }
    }
  }
  for (const event of Object.keys(conformance.representativeIntents)) {
    if (!eventVariants.has(event)) {
      throw new Error(
        `${conformance.machineId}: representative intent references unknown event ${event}`,
      );
    }
  }
  unique(
    conformance.exclusions.map(({ tier }) => tier),
    `${conformance.machineId} excluded tiers`,
  );
  const activeTiers = new Set<ConformanceTier>(conformance.tiers);
  for (const exclusion of conformance.exclusions) {
    if (exclusion.reason.trim().length === 0) {
      throw new Error(
        `${conformance.machineId}: exclusion ${exclusion.tier} requires a reason`,
      );
    }
    if (activeTiers.has(exclusion.tier)) {
      throw new Error(
        `${conformance.machineId}: tier ${exclusion.tier} cannot be both applicable and excluded`,
      );
    }
  }
  return Object.freeze(conformance);
}

export interface EnvelopeBudgetResult {
  readonly label: string;
  readonly declaredLimit: number;
  readonly measuredSize: number;
  readonly headroom: number;
}

export function assertEnvelopeBudget<Value>(options: {
  readonly label: string;
  readonly codec: z.ZodType<Value>;
  readonly declaredLimit: number;
  readonly worstCase: () => unknown;
  readonly toEnvelope: (value: Value) => unknown;
}): EnvelopeBudgetResult {
  const parsed = options.codec.parse(options.worstCase());
  const measuredSize = serialize(options.toEnvelope(parsed)).byteLength;
  const result = {
    label: options.label,
    declaredLimit: options.declaredLimit,
    measuredSize,
    headroom: options.declaredLimit - measuredSize,
  };
  if (result.headroom < 0) {
    throw new Error(
      `${result.label} envelope budget exceeded: declared=${result.declaredLimit}B measured=${result.measuredSize}B headroom=${result.headroom}B`,
    );
  }
  return result;
}

export interface ConformanceIdentityRecord {
  readonly message?: string;
  readonly request?: string;
  readonly invocation?: string;
  readonly actor?: string;
  readonly revision?: number;
  readonly window?: string;
}

export interface ConformanceResourceCounts {
  readonly waiters?: number;
  readonly tasks?: number;
  readonly timers?: number;
  readonly subscriptions?: number;
  readonly routes?: number;
  readonly actors?: number;
}

export interface ConformanceDiagnostic {
  readonly summary: string;
  readonly criticalSchedule: readonly string[];
  readonly identities: ConformanceIdentityRecord;
  readonly resources: {
    readonly expected: ConformanceResourceCounts;
    readonly actual: ConformanceResourceCounts;
  };
  readonly redactedRecord: Readonly<Record<string, unknown>>;
}

export function createConformanceDiagnostic(options: {
  readonly summary: string;
  readonly schedules: readonly (readonly string[])[];
  readonly identities: ConformanceIdentityRecord;
  readonly resources: {
    readonly expected: ConformanceResourceCounts;
    readonly actual: ConformanceResourceCounts;
  };
  readonly record: Readonly<Record<string, unknown>>;
  readonly redact: (
    record: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
}): ConformanceDiagnostic {
  const criticalSchedule = [...options.schedules].sort(
    (left, right) =>
      left.length - right.length ||
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0];
  if (!criticalSchedule) {
    throw new Error("Conformance diagnostics require at least one schedule");
  }
  return {
    summary: options.summary,
    criticalSchedule,
    identities: options.identities,
    resources: options.resources,
    redactedRecord: options.redact(options.record),
  };
}

export function formatConformanceDiagnostic(
  diagnostic: ConformanceDiagnostic,
): string {
  const identityOrder = [
    "message",
    "request",
    "invocation",
    "actor",
    "revision",
    "window",
  ] as const;
  const resourceOrder = [
    "waiters",
    "tasks",
    "timers",
    "subscriptions",
    "routes",
    "actors",
  ] as const;
  const identities = identityOrder
    .map((key) => `${key}=${diagnostic.identities[key] ?? "-"}`)
    .join(" ");
  const resources = resourceOrder
    .map(
      (key) =>
        `${key}=${diagnostic.resources.actual[key] ?? 0}/${diagnostic.resources.expected[key] ?? 0}`,
    )
    .join(" ");
  return [
    diagnostic.summary,
    `schedule: ${diagnostic.criticalSchedule.join(" -> ")}`,
    `identities: ${identities}`,
    `resources(actual/expected): ${resources}`,
    `record: ${JSON.stringify(diagnostic.redactedRecord)}`,
  ].join("\n");
}

export function formatContractReport(
  registrations: readonly {
    readonly contract: {
      readonly intents: Readonly<Record<string, RemoteIntentPolicy>>;
      readonly budgets: RemoteIntentEnvelopeBudgets;
    };
    readonly conformance: MachineConformance;
  }[],
  unsafeEscapeHatches: Readonly<Record<string, readonly string[]>>,
): string {
  const formatRevision = (
    revision: RemoteIntentPolicy["observedRevision"],
  ): string => {
    switch (revision.kind) {
      case "none":
        return "none";
      case "actor":
        return `actor(required=${revision.required})`;
      case "domain":
        return `domain(name=${revision.name},required=${revision.required})`;
    }
  };
  const formatRetry = (retry: RemoteIntentPolicy["retry"]): string => {
    switch (retry.kind) {
      case "none":
        return "none";
      case "stable-id":
        return `stable-id(identity=${retry.identity},dedup=${retry.receiverDeduplication},lifetime=${retry.lifetime})`;
    }
  };
  const sections = [...registrations]
    .sort((left, right) =>
      left.conformance.machineId.localeCompare(right.conformance.machineId),
    )
    .map(({ contract, conformance }) => {
      const intents = Object.entries(contract.intents)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([type, policy]) =>
            `  ${type}: completion=${policy.completion} revision=${formatRevision(policy.observedRevision)} retry=${formatRetry(policy.retry)} acceptance=${policy.acceptance} input=${policy.inputDisposition}`,
        );
      const exclusions =
        conformance.exclusions.length === 0
          ? ["  none"]
          : conformance.exclusions
              .map(({ tier, reason }) => `  ${tier}: ${reason}`)
              .sort();
      return [
        conformance.machineId,
        `tiers: ${[...conformance.tiers].sort().join(",")}`,
        `budgets: intent=${contract.budgets.intentBytes} snapshot=${contract.budgets.snapshotBytes}`,
        "intents:",
        ...intents,
        "exclusions:",
        ...exclusions,
      ].join("\n");
    });
  const escapes = Object.entries(unsafeEscapeHatches)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([kind, locations]) => [
      `${kind}:`,
      ...[...locations].sort().map((location) => `  ${location}`),
    ]);
  return [...sections, "unsafe escape hatches", ...escapes].join("\n");
}
