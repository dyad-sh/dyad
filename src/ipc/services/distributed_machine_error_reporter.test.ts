import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { sendTelemetryException } from "@/ipc/utils/telemetry";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { stay } from "@/state_machines/types";
import { remoteMachineHost } from "./distributed_machine_actor_host";
import {
  reportActorHostError,
  reportRemoteTransportError,
} from "./distributed_machine_error_reporter";

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryException: vi.fn(),
}));

type Event = { readonly type: "RUN" };
type Command = { readonly type: "FAIL" };

function failingMachine(
  error: unknown,
): DistributedMachineDefinition<
  string,
  string,
  Record<string, never>,
  Event,
  Command,
  never
> {
  return {
    id: "failing-machine",
    host: "main",
    initialState: () => ({}),
    transition: (state) => stay(state, [{ type: "FAIL" }]),
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: () => () => {
      throw error;
    },
    lifecycle: {
      subscriptionCreates: true,
      dispatchCreates: true,
      idleEviction: { kind: "retain" },
      terminalRetention: { kind: "retain" },
      entityDeletion: "dispose",
      rendererOwnership: "host",
      survivesRendererReload: true,
      restartPersistence: "ephemeral",
      flushOnShutdown: true,
      isTerminal: () => false,
    },
  };
}

describe("state machine error reporting", () => {
  beforeEach(() => {
    vi.mocked(sendTelemetryException).mockClear();
  });

  it("is wired into the production host", () => {
    expect(remoteMachineHost["options"].reportError).toBe(reportActorHostError);
  });

  it("reports a command that throws with its machine and stage", async () => {
    const error = new Error("git exploded");
    const host = new ActorHost({
      placement: "main",
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
      reportError: reportActorHostError,
    });
    const definition = failingMachine(error);
    host.register(definition);

    host.ensure(definition, "entity").send({ type: "RUN" });

    await vi.waitFor(() =>
      expect(sendTelemetryException).toHaveBeenCalledWith(error, {
        source: "state_machine:failing-machine",
        phase: "command",
      }),
    );
  });

  it("reports a failure the host raises itself without a stage", () => {
    const error = new Error("timer cancel failed");

    reportActorHostError({ machineId: "m", key: "k", failure: error });

    expect(sendTelemetryException).toHaveBeenCalledWith(error, {
      source: "state_machine:m",
    });
  });

  it("reports transport failures", () => {
    const error = new Error("send failed");

    reportRemoteTransportError(error);

    expect(sendTelemetryException).toHaveBeenCalledWith(error, {
      source: "state_machine_transport",
    });
  });

  it("never throws into the machine", () => {
    vi.mocked(sendTelemetryException).mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });

    expect(() =>
      reportActorHostError({
        machineId: "m",
        key: "k",
        failure: new DyadError("x", DyadErrorKind.Internal),
      }),
    ).not.toThrow();
  });
});
