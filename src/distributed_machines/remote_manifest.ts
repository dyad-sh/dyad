import type { IgnoreReason } from "@/state_machines/types";
import type {
  DistributedMachineDefinition,
  FrameworkCoveredRemoteMachine,
} from "./definition";
import { MachineIdentitySchema } from "./remote_protocol";

/**
 * Production definitions intentionally left on the protocol-v1 event
 * compatibility adapter in PR4. Remove IDs only in their domain migration PR.
 */
export const REMOTE_PROTOCOL_V1_COMPATIBILITY_INVENTORY = Object.freeze([
  "chat_stream",
  "github_ops",
  "image_generation",
  "plan_handoff",
]);

export const LEGACY_REMOTE_MACHINE_DEFINITION_INVENTORY = Object.freeze([
  "chat_stream",
  "github_ops",
  "plan_handoff",
] as const);

export function assertRemoteProtocolV1CompatibilityInventory(
  definitions: readonly AnyRemoteMachineDefinition[],
): void {
  const expected = new Set(REMOTE_PROTOCOL_V1_COMPATIBILITY_INVENTORY);
  const actual = new Set(
    definitions
      .filter((definition) => definition.remoteIntent === undefined)
      .map((definition) => definition.id),
  );
  const unlisted = [...actual].filter((id) => !expected.has(id));
  const stale = [...expected].filter((id) => !actual.has(id));
  if (unlisted.length === 0 && stale.length === 0) return;

  throw new Error(
    [
      "Remote protocol-v1 compatibility inventory is out of date.",
      unlisted.length > 0 ? `Unlisted: ${unlisted.join(", ")}` : undefined,
      stale.length > 0 ? `Stale: ${stale.join(", ")}` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

type ErasedRemoteMachineDefinition = Omit<
  DistributedMachineDefinition<
    string,
    any,
    any,
    any,
    any,
    IgnoreReason,
    any,
    any
  >,
  "createOutcomePublisher"
> & {
  readonly createOutcomePublisher?: any;
};

export type AnyRemoteMachineDefinition = ErasedRemoteMachineDefinition & {
  readonly host: "main";
  readonly remote: NonNullable<ErasedRemoteMachineDefinition["remote"]>;
};

declare const legacyRemoteMachineCompatibility: unique symbol;

export type LegacyRemoteMachineCompatibility<
  Definition extends AnyRemoteMachineDefinition,
> = Definition & {
  readonly [legacyRemoteMachineCompatibility]: true;
};

export type RegisteredRemoteMachineDefinition =
  | FrameworkCoveredRemoteMachine<AnyRemoteMachineDefinition>
  | LegacyRemoteMachineCompatibility<AnyRemoteMachineDefinition>;

/**
 * Explicit capability for the exact production definitions that have not
 * migrated. New IDs cannot acquire this brand without changing the
 * review-visible inventory.
 */
export function defineLegacyRemoteMachineCompatibility<
  const Definition extends AnyRemoteMachineDefinition,
>(definition: Definition): LegacyRemoteMachineCompatibility<Definition> {
  if (
    !LEGACY_REMOTE_MACHINE_DEFINITION_INVENTORY.includes(
      definition.id as (typeof LEGACY_REMOTE_MACHINE_DEFINITION_INVENTORY)[number],
    )
  ) {
    throw new Error(
      `Remote machine ${definition.id} is not in the legacy definition inventory`,
    );
  }
  return definition as LegacyRemoteMachineCompatibility<Definition>;
}

export interface RemoteMachineManifest {
  readonly definitions: readonly AnyRemoteMachineDefinition[];
  get(machineId: string): AnyRemoteMachineDefinition | undefined;
}

export function createRemoteMachineManifest(
  definitions: readonly AnyRemoteMachineDefinition[],
): RemoteMachineManifest {
  const byId = new Map<string, AnyRemoteMachineDefinition>();
  for (const definition of definitions) {
    const identity = MachineIdentitySchema.safeParse({
      machineId: definition.id,
      protocolVersion: definition.remote.protocolVersion,
    });
    if (!identity.success) {
      throw new Error(
        `Invalid remote machine identity for ${definition.id || "<empty>"}: ${identity.error.message}`,
      );
    }
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate remote machine ID: ${definition.id}`);
    }
    if (definition.host !== "main") {
      throw new Error(`Remote machine ${definition.id} must be main-hosted`);
    }
    for (const [name, limit] of [
      ["maxDispatchEnvelopeBytes", definition.remote.maxDispatchEnvelopeBytes],
      ["maxSnapshotEnvelopeBytes", definition.remote.maxSnapshotEnvelopeBytes],
    ] as const) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
        throw new Error(
          `Remote machine ${definition.id} has an invalid ${name}`,
        );
      }
    }
    byId.set(definition.id, definition);
  }
  const frozenDefinitions = Object.freeze([...definitions]);
  return Object.freeze({
    definitions: frozenDefinitions,
    get: (machineId: string) => byId.get(machineId),
  });
}

/**
 * Authoritative production registration boundary. Generic manifests remain
 * available to test fixtures, but production definitions must present either
 * the framework-covered capability or the exact legacy compatibility brand.
 */
export function createProductionRemoteMachineManifest(
  definitions: readonly RegisteredRemoteMachineDefinition[],
): RemoteMachineManifest {
  return createRemoteMachineManifest(definitions);
}
