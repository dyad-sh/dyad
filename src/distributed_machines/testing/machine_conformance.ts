import { serialize } from "node:v8";
import type { z } from "zod";
import type {
  RemoteIntentEnvelopeBudgets,
  RemoteIntentPolicy,
} from "../remote_intent_contract";

export const CONFORMANCE_TIERS = ["T0", "T1", "T2", "T3", "T4"] as const;
export type ConformanceTier = (typeof CONFORMANCE_TIERS)[number];

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
    Record<string, readonly string[]>
  >;
  readonly representativeIntents: Readonly<
    Record<
      string,
      {
        readonly event: EventVariant;
        readonly create: () => unknown;
      }
    >
  >;
  readonly historicalFailureShapes: readonly HistoricalFailureShape[];
}

export function defineVariantInventory<Variant extends string>() {
  return <const Inventory extends readonly Variant[]>(
    inventory: Inventory &
      ([Exclude<Variant, Inventory[number]>] extends [never]
        ? unknown
        : {
            readonly __missingVariants: Exclude<Variant, Inventory[number]>;
          }),
  ): Inventory => inventory;
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
  const representativeOwners = new Map<string, string>();
  for (const [capability, representativeIds] of Object.entries(
    conformance.representativeCapabilities,
  )) {
    if (representativeIds.length === 0) {
      throw new Error(
        `${conformance.machineId}: capability ${capability} has no representative intents`,
      );
    }
    unique(
      representativeIds,
      `${conformance.machineId} capability ${capability} representatives`,
    );
    for (const representativeId of representativeIds) {
      const previousOwner = representativeOwners.get(representativeId);
      if (previousOwner) {
        throw new Error(
          `${conformance.machineId}: representative intent ${representativeId} is shared by capabilities ${previousOwner} and ${capability}`,
        );
      }
      representativeOwners.set(representativeId, capability);
      if (!conformance.representativeIntents[representativeId]) {
        throw new Error(
          `${conformance.machineId}: capability ${capability} references unknown representative intent ${representativeId}`,
        );
      }
    }
  }
  for (const [representativeId, representative] of Object.entries(
    conformance.representativeIntents,
  )) {
    if (!eventVariants.has(representative.event)) {
      throw new Error(
        `${conformance.machineId}: representative intent ${representativeId} references unknown event ${representative.event}`,
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
  const classifiedTiers = new Set<ConformanceTier>([
    ...conformance.tiers,
    ...conformance.exclusions.map(({ tier }) => tier),
  ]);
  const omittedTiers = CONFORMANCE_TIERS.filter(
    (tier) => !classifiedTiers.has(tier),
  );
  if (omittedTiers.length > 0) {
    throw new Error(
      `${conformance.machineId}: conformance tiers are unclassified: ${omittedTiers.join(",")}`,
    );
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
  const summarizeLocations = (locations: readonly string[]): string[] => {
    const counts = new Map<string, number>();
    for (const location of locations) {
      const sourcePath = location.includes("::")
        ? location.slice(0, location.indexOf("::"))
        : location.replace(/:\d+:\d+$/, "");
      counts.set(sourcePath, (counts.get(sourcePath) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourcePath, count]) => `${sourcePath}#${count}`);
  };
  const escapes = Object.entries(unsafeEscapeHatches)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([kind, locations]) => [
      `${kind}:`,
      ...summarizeLocations(locations).map((location) => `  ${location}`),
    ]);
  return [...sections, "unsafe escape hatches", ...escapes].join("\n");
}
