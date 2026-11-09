import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { change, stay } from "@/state_machines/types";
import { reportableStack } from "@/ipc/utils/telemetry";
import { remoteMachineHost } from "./distributed_machine_actor_host";
import {
  reportActorHostError,
  reportRemoteTransportError,
} from "./distributed_machine_error_reporter";

// What the main process sends to the renderer, where PostHog captures it.
const { sent } = vi.hoisted(() => ({
  sent: [] as { eventName: string; properties: Record<string, unknown> }[],
}));
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (_channel: string, payload: (typeof sent)[number]) =>
            sent.push(payload),
        },
      },
    ],
  },
}));

type State = { readonly prompt: string };
type Event = { readonly type: "RUN" };
type Command = { readonly type: "start-stream" };

function machine(
  overrides: Partial<
    DistributedMachineDefinition<string, string, State, Event, Command, never>
  >,
): DistributedMachineDefinition<string, string, State, Event, Command, never> {
  return {
    id: "test-machine",
    host: "main",
    initialState: () => ({ prompt: "my secret prompt" }),
    transition: (state) => stay(state, [{ type: "start-stream" }]),
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: () => () => undefined,
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
    ...overrides,
  };
}

function run(definition: ReturnType<typeof machine>): void {
  const host = new ActorHost({
    placement: "main",
    clock: createFakeClock(),
    ids: createSequentialIdSource(),
    reportError: reportActorHostError,
  });
  host.register(definition);
  host.ensure(definition, "entity").send({ type: "RUN" });
}

describe("state machine error reporting", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("is wired into the production host", () => {
    expect(remoteMachineHost["options"].reportError).toBe(reportActorHostError);
  });

  it("reports a command that throws with its machine and stage", async () => {
    const thrown = new TypeError("cannot read stream of undefined");
    run(
      machine({
        createCommandRunner: () => () => {
          throw thrown;
        },
      }),
    );

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      eventName: "$exception",
      properties: {
        exception_name: "TypeError",
        exception_message: "",
        exception_stack_trace: reportableStack(thrown),
        source: "state_machine:test-machine",
        phase: "command",
      },
    });
    // Nothing checks a command type against a fixed set, so it stays local.
    expect(sent[0].properties).not.toHaveProperty("command_type");
  });

  it("never sends machine state from a validation error", async () => {
    // A value-equal state in a new object fails validation, whose message
    // prints the whole state.
    run(machine({ transition: (state) => change({ ...state }) }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].properties).toMatchObject({ phase: "validation" });
    expect(JSON.stringify(sent)).not.toContain("my secret prompt");
  });

  it("does not send expected errors", async () => {
    run(
      machine({
        createCommandRunner: () => () => {
          throw new DyadError("chat not found", DyadErrorKind.NotFound);
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toEqual([]);
  });

  it("reports a failure the host raises itself without a stage", () => {
    reportActorHostError({
      machineId: "m",
      key: "k",
      failure: new Error("timer cancel failed"),
    });

    expect(sent[0].properties).toMatchObject({
      exception_name: "Error",
      exception_message: "",
      source: "state_machine:m",
    });
    expect(sent[0].properties).not.toHaveProperty("phase");
  });

  it("does not send a stage the dispatcher does not use", () => {
    reportActorHostError({
      machineId: "m",
      key: "k",
      failure: { stage: "secret-stage", error: new Error("x") },
    });

    expect(sent[0].properties).not.toHaveProperty("phase");
    expect(JSON.stringify(sent)).not.toContain("secret-stage");
  });

  it("sends an unlisted error name as UnlistedError", () => {
    const error = new Error("x");
    error.name = "secret-name";

    reportRemoteTransportError(error);

    expect(sent[0].properties.exception_name).toBe("UnlistedError");
    expect(sent[0].properties.exception_stack_trace).toBe(
      reportableStack(error),
    );
    expect(JSON.stringify(sent)).not.toContain("secret-name");
  });

  it("keeps a multi-line name out of the frames", () => {
    const error = new Error("");
    error.name = "Error\n    at secret-frame";

    reportRemoteTransportError(error);

    expect(JSON.stringify(sent)).not.toContain("secret-frame");
  });

  it("sends a string stack for an error without one", () => {
    const error = new Error("x");
    error.stack = undefined;

    reportRemoteTransportError(error);

    expect(sent[0].properties.exception_stack_trace).toBe("Error");
  });

  it("reports transport failures without their message", () => {
    reportRemoteTransportError(new Error("snapshot for chat 12 too large"));

    expect(sent[0].properties).toMatchObject({
      exception_message: "",
      source: "state_machine_transport",
    });
    expect(JSON.stringify(sent)).not.toContain("chat 12");
  });
});
