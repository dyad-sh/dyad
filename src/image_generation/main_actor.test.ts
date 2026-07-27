import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import { FakeDuplexRemoteTransport } from "@/distributed_machines/testing";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import {
  IMAGE_GENERATION_TERMINAL_RETENTION_MS,
  imageGenerationDefinition,
} from "@/ipc/services/image_generation_definition";
import {
  getImageGenerationKey,
  imageGenerationClientDefinition,
} from "./transport";

const service = vi.hoisted(() => ({
  generate: vi.fn(),
  cancel: vi.fn(() => true),
  cancelAndSettleAll: vi.fn(async () => undefined),
}));
const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 7 }) as { id: number } | undefined),
}));
const invalidations = vi.hoisted(() => ({ publish: vi.fn() }));
const presentation = vi.hoisted(() => ({
  clear: vi.fn(),
  present: vi.fn(),
  recordInitiator: vi.fn(),
}));

vi.mock("@/ipc/services/image_generation_service", () => ({
  imageGenerationService: service,
}));
vi.mock("@/ipc/services/image_generation_presentation_service", () => ({
  imageGenerationPresentationService: presentation,
}));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));
vi.mock(
  "@/window_infrastructure/main/query_invalidation_bus",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/window_infrastructure/main/query_invalidation_bus")
    >()),
    queryInvalidationBus: invalidations,
  }),
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness() {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
  });
  const manifest = createRemoteMachineManifest([imageGenerationDefinition]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  const clientA = new RemoteMachineClient(
    duplex.connect(),
    createSequentialIdSource(),
  );
  const clientB = new RemoteMachineClient(
    duplex.connect(),
    createSequentialIdSource(),
  );
  clientA.start();
  clientB.start();
  const actorA = clientA.actor(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
  );
  const actorB = clientB.actor(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
  );
  const releaseA = actorA.subscribe(() => undefined);
  const releaseB = actorB.subscribe(() => undefined);
  return {
    actorA,
    actorB,
    clientA,
    clock,
    host,
    releaseA,
    releaseB,
    transport,
  };
}

const submit = {
  type: "SUBMIT" as const,
  job: {
    id: "job-1",
    prompt: "A lighthouse",
    themeMode: "plain" as const,
    targetAppId: 7,
    targetAppName: "App",
    source: "chat" as const,
    startedAt: 10,
  },
  operationId: "operation-1",
};

describe("main-hosted image generation actor", () => {
  beforeEach(() => {
    service.generate.mockReset();
    service.cancel.mockReset();
    service.cancel.mockReturnValue(true);
    service.cancelAndSettleAll.mockReset();
    service.cancelAndSettleAll.mockResolvedValue(undefined);
    database.findFirst.mockReset();
    database.findFirst.mockResolvedValue({ id: 7 });
    invalidations.publish.mockReset();
    presentation.clear.mockReset();
    presentation.present.mockReset();
    presentation.recordInitiator.mockReset();
  });

  it("shares a job with a second window and continues after the initiator closes", async () => {
    const generation = deferred<{
      fileName: string;
      filePath: string;
      appPath: string;
      appId: number;
      appName: string;
    }>();
    service.generate.mockReturnValue(generation.promise);
    const { actorA, actorB, clientA, releaseA, transport } = createHarness();
    await actorA.resync();
    await actorB.resync();

    await expect(actorA.dispatch(submit)).resolves.toMatchObject({
      kind: "applied",
    });
    expect(actorB.getSnapshot().jobs[0]).toMatchObject({
      id: "job-1",
      status: "pending",
    });
    releaseA();
    clientA.dispose();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);

    generation.resolve({
      fileName: "generated.png",
      filePath: "/tmp/generated.png",
      appPath: "app",
      appId: 7,
      appName: "App",
    });
    await flush();
    expect(actorB.getSnapshot().jobs[0]).toMatchObject({
      status: "success",
      result: { fileName: "generated.png" },
    });
    expect(actorB.getSnapshot().jobs[0]?.result).not.toHaveProperty("filePath");
    expect(invalidations.publish).toHaveBeenCalledWith([{ family: "media" }]);
  });

  it("requires the active invocation for cancellation", async () => {
    service.generate.mockReturnValue(new Promise(() => undefined));
    const { actorA } = createHarness();
    await actorA.resync();
    await actorA.dispatch(submit);
    const activeInvocationRef =
      actorA.getSnapshot().jobs[0]?.activeInvocationRef;
    if (!activeInvocationRef) throw new Error("missing invocation");

    await expect(
      actorA.dispatch({
        type: "CANCEL_REQUESTED",
        jobId: "job-1",
        activeInvocationRef: {
          ...activeInvocationRef,
          operationId: "stale",
        },
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "unauthorized" });
    await expect(
      actorA.dispatch({
        type: "CANCEL_REQUESTED",
        jobId: "job-1",
        activeInvocationRef,
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(actorA.getSnapshot().jobs[0]?.status).toBe("cancelling");
  });

  it("does not persist jobs across actor recreation", async () => {
    service.generate.mockReturnValue(new Promise(() => undefined));
    const { actorA, host } = createHarness();
    await actorA.resync();
    await actorA.dispatch(submit);
    await host.disposeKey(
      imageGenerationDefinition.id,
      getImageGenerationKey(),
    );

    const replacement = host.ensure(
      imageGenerationDefinition,
      getImageGenerationKey(),
    );
    expect(replacement.getSnapshot()).toEqual({ jobs: [] });
    expect(service.cancelAndSettleAll).toHaveBeenCalled();
  });

  it("retains terminal jobs for 30 minutes, then disposes the collection", async () => {
    service.generate.mockResolvedValue({
      fileName: "generated.png",
      filePath: "/tmp/generated.png",
      appPath: "app",
      appId: 7,
      appName: "App",
    });
    const { actorA, clock, host } = createHarness();
    await actorA.resync();
    await actorA.dispatch(submit);
    await flush();
    expect(
      host.peek(imageGenerationDefinition.id, getImageGenerationKey()),
    ).toBeDefined();

    clock.advanceBy(IMAGE_GENERATION_TERMINAL_RETENTION_MS - 1);
    expect(
      host.peek(imageGenerationDefinition.id, getImageGenerationKey()),
    ).toBeDefined();
    clock.advanceBy(1);
    await flush();
    expect(
      host.peek(imageGenerationDefinition.id, getImageGenerationKey()),
    ).toBeUndefined();
  });
});
