import { z } from "zod";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import { sameInvocationRef } from "@/state_machines/invocation_ref";
import { change, ignore, stay } from "@/state_machines/types";
import type {
  ActorLifecyclePolicy,
  DistributedMachineDefinition,
} from "../definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "../remote_protocol";

const InvocationRefSchema = z
  .object({
    kind: z.literal("remote-test"),
    entityKey: z.string().min(1),
    operationId: z.string().min(1),
  })
  .strict();

export const RemoteTestEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INCREMENT") }).strict(),
  z.object({ type: z.literal("IGNORE") }).strict(),
  z
    .object({
      type: z.literal("START"),
      invocationRef: InvocationRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL"),
      invocationRef: InvocationRefSchema,
    })
    .strict(),
  z.object({ type: z.literal("FAIL_COMMAND") }).strict(),
]);

export const RemoteTestSnapshotSchema = z
  .object({
    value: z.number().int(),
    activeInvocationRef: InvocationRefSchema.optional(),
  })
  .strict();

export interface RemoteTestState {
  readonly value: number;
  readonly activeInvocationRef?: InvocationRef<"remote-test", string>;
  readonly mainSecret: string;
}

export type RemoteTestEvent = z.infer<typeof RemoteTestEventSchema>;
type RemoteTestCommand = { readonly type: "FAIL" };
type RemoteTestReason = "ignored" | "stale-invocation";

export function remoteTestLifecycle(
  overrides: Partial<ActorLifecyclePolicy<string, RemoteTestState>> = {},
): ActorLifecyclePolicy<string, RemoteTestState> {
  return {
    subscriptionCreates: true,
    dispatchCreates: true,
    idleEviction: { kind: "retain" },
    terminalRetention: { kind: "retain" },
    entityDeletion: "dispose",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "ephemeral",
    flushOnShutdown: true,
    ...overrides,
  };
}

export function createRemoteTestMachine(
  id = "remote-test",
  lifecycle = remoteTestLifecycle(),
): DistributedMachineDefinition<
  string,
  string,
  RemoteTestState,
  RemoteTestEvent,
  RemoteTestCommand,
  RemoteTestReason
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      string,
      string,
      RemoteTestState,
      RemoteTestEvent,
      RemoteTestCommand,
      RemoteTestReason
    >["remote"]
  >;
} {
  return {
    id,
    host: "main",
    initialState: (key) => ({ value: 0, mainSecret: `secret:${key}` }),
    transition(state, event) {
      switch (event.type) {
        case "INCREMENT":
          return change({ ...state, value: state.value + 1 });
        case "IGNORE":
          return ignore(state, "ignored");
        case "START":
          return change({ ...state, activeInvocationRef: event.invocationRef });
        case "CANCEL":
          return state.activeInvocationRef &&
            sameInvocationRef(state.activeInvocationRef, event.invocationRef)
            ? change({
                value: state.value,
                mainSecret: state.mainSecret,
              })
            : ignore(state, "stale-invocation");
        case "FAIL_COMMAND":
          return stay(state, [{ type: "FAIL" }]);
      }
    },
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: () => async () => {
      throw new Error("synthetic command failure");
    },
    lifecycle,
    remote: {
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      keyCodec: z.string().min(1).max(128),
      eventCodec: RemoteTestEventSchema,
      snapshotCodec: RemoteTestSnapshotSchema,
      keyToString: (key) => key,
      projectSnapshot: (state) => ({
        value: state.value,
        activeInvocationRef: state.activeInvocationRef,
      }),
      revisionPolicy: (event) =>
        event.type === "INCREMENT" ? "reject-stale" : "allow-stale",
      authorizeSubscribe({ key }) {
        if (key === "forbidden") throw new Error("forbidden key");
      },
      authorizeDispatch({ key, event }) {
        if (key === "forbidden") throw new Error("forbidden key");
        if (
          (event.type === "START" || event.type === "CANCEL") &&
          event.invocationRef.entityKey !== key
        ) {
          throw new Error("invocation ref belongs to another actor");
        }
      },
    },
  };
}
