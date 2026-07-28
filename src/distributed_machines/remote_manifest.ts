import type { IgnoreReason } from "@/state_machines/types";
import type { DistributedMachineDefinition } from "./definition";
import { MachineIdentitySchema } from "./remote_protocol";

export type AnyRemoteMachineDefinition = DistributedMachineDefinition<
  string,
  any,
  any,
  any,
  any,
  IgnoreReason
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      string,
      any,
      any,
      any,
      any,
      IgnoreReason
    >["remote"]
  >;
};

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
