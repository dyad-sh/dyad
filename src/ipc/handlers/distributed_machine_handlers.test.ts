// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import { createRemoteTestMachine } from "@/distributed_machines/testing";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { WindowRegistry } from "@/window_infrastructure/main/window_registry";
import { configureTrustedRenderer } from "../utils/renderer_security";

const mocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, input: unknown) => Promise<unknown>
  >(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, input: unknown) => Promise<unknown>,
      ) => mocks.handlers.set(channel, handler),
    ),
  },
}));

const { registerDistributedMachineHandlers } =
  await import("./distributed_machine_handlers");

function createTransport() {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
  });
  const definition = createRemoteTestMachine();
  return new RemoteMachineTransport({
    host,
    manifest: createRemoteMachineManifest([definition]),
    windows: new WindowRegistry(),
    clock,
  });
}

function eventFor(url: string) {
  const frame = { url };
  const sender = {
    id: 101,
    mainFrame: frame,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
  };
  return { sender, senderFrame: frame };
}

describe("distributed machine IPC handlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    registerDistributedMachineHandlers(createTransport());
  });

  it("uses trusted typed handlers and double-validates the wire payload", async () => {
    const trustedEvent = eventFor("http://localhost:5173/chat");
    const subscribe = mocks.handlers.get("distributed-machine:subscribe")!;

    await expect(
      subscribe(trustedEvent, {
        protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
        machineId: "remote-test",
        encodedKey: "actor",
        rendererConnectionId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        machineId: "remote-test",
        encodedState: { value: 0 },
      },
    });

    await expect(
      subscribe(trustedEvent, {
        protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
        machineId: "",
        encodedKey: "actor",
        rendererConnectionId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });

    await expect(
      subscribe(trustedEvent, {
        protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
        machineId: "remote-test",
        encodedKey: 42,
        rendererConnectionId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });

  it("rejects non-main-frame senders before routing to the manifest", async () => {
    const subscribe = mocks.handlers.get("distributed-machine:subscribe")!;
    await expect(
      subscribe(eventFor("https://attacker.example/"), {
        protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
        machineId: "remote-test",
        encodedKey: "actor",
        rendererConnectionId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("trusted Dyad renderer") },
    });
  });

  it("routes subscription ownership through the renderer connection identity", async () => {
    const transport = {
      subscribe: vi.fn(async () => ({
        protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
        machineId: "remote-test",
        encodedKey: "actor",
        actorInstanceId: "actor:1",
        revision: 0,
        encodedState: { value: 0 },
      })),
      dispatch: vi.fn(async (input: { messageId: string }) => ({
        kind: "rejected" as const,
        messageId: input.messageId,
        reason: "stale-actor" as const,
      })),
      unsubscribe: vi.fn(async () => undefined),
    };
    registerDistributedMachineHandlers(transport as never);
    const address = {
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      machineId: "remote-test",
      encodedKey: "actor",
    };
    const oldDocument = eventFor("http://localhost:5173/chat");
    const replacementDocument = eventFor("http://localhost:5173/chat");

    await mocks.handlers.get("distributed-machine:subscribe")!(oldDocument, {
      ...address,
      rendererConnectionId: "00000000-0000-4000-8000-000000000001",
    });
    await mocks.handlers.get("distributed-machine:subscribe")!(
      replacementDocument,
      {
        ...address,
        rendererConnectionId: "00000000-0000-4000-8000-000000000002",
      },
    );
    await mocks.handlers.get("distributed-machine:unsubscribe")!(oldDocument, {
      ...address,
      rendererConnectionId: "00000000-0000-4000-8000-000000000001",
    });

    expect(transport.subscribe).toHaveBeenNthCalledWith(
      1,
      oldDocument.sender,
      address,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(transport.subscribe).toHaveBeenNthCalledWith(
      2,
      replacementDocument.sender,
      address,
      "00000000-0000-4000-8000-000000000002",
    );
    expect(transport.unsubscribe).toHaveBeenCalledWith(
      oldDocument.sender,
      address,
      "00000000-0000-4000-8000-000000000001",
    );
  });
});
