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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  IMAGE_GENERATION_TERMINAL_RETENTION_MS,
  imageGenerationDefinition,
} from "@/ipc/services/image_generation_definition";
import {
  getImageGenerationKey,
  imageGenerationClientDefinition,
} from "./transport";
import type { RequestId } from "@/distributed_machines/request_identity";
import { imageGenerationOperationService } from "@/ipc/services/image_generation_operation_service";

const service = vi.hoisted(() => ({
  generate: vi.fn(),
  cancel: vi.fn(() => true),
  cancelAndSettleAll: vi.fn(async () => undefined),
  assertAcceptingGenerations: vi.fn(),
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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
  const connectionA = duplex.connect();
  const connectionB = duplex.connect();
  const clientA = new RemoteMachineClient(
    connectionA,
    createSequentialIdSource(),
  );
  const clientB = new RemoteMachineClient(
    connectionB,
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
    windowSessionA: connectionA.sessionId,
    windows,
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
  requestId: "request-1" as RequestId,
  operationId: "operation-1",
};

describe("main-hosted image generation actor", () => {
  let requestSequence = 0;

  beforeEach(() => {
    requestSequence += 1;
    submit.requestId = `request-${requestSequence}` as RequestId;
    service.generate.mockReset();
    service.cancel.mockReset();
    service.cancel.mockReturnValue(true);
    service.cancelAndSettleAll.mockReset();
    service.cancelAndSettleAll.mockResolvedValue(undefined);
    service.assertAcceptingGenerations.mockReset();
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
    const {
      actorA,
      actorB,
      clientA,
      releaseA,
      transport,
      windowSessionA,
      windows,
    } = createHarness();
    await actorA.resync();
    await actorB.resync();

    await expect(actorA.dispatch(submit)).resolves.toMatchObject({
      kind: "applied",
    });
    const initiatingTicket = imageGenerationOperationService.registry.ticketFor(
      submit.requestId,
      () => true,
    );
    expect(actorB.getSnapshot().jobs[0]).toMatchObject({
      id: "job-1",
      status: "pending",
    });
    releaseA();
    clientA.dispose();
    windows.destroy(windowSessionA);
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
    await expect(initiatingTicket?.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded", jobId: "job-1" },
    });
  });

  it("admits parallel jobs and settles each by stable request/runtime identity", async () => {
    const generations = new Map<
      string,
      ReturnType<
        typeof deferred<{
          fileName: string;
          filePath: string;
          appPath: string;
          appId: number;
          appName: string;
        }>
      >
    >();
    service.generate.mockImplementation(
      ({ requestId }: { requestId: string }) => {
        const generation = deferred<{
          fileName: string;
          filePath: string;
          appPath: string;
          appId: number;
          appName: string;
        }>();
        generations.set(requestId, generation);
        return generation.promise;
      },
    );
    const { actorA } = createHarness();
    await actorA.resync();
    const second = {
      ...submit,
      requestId: `${submit.requestId}:second` as RequestId,
      operationId: "operation-2",
      job: { ...submit.job, id: "job-2", prompt: "A forest" },
    };

    await actorA.dispatch(submit);
    await actorA.dispatch(second);
    expect(actorA.getSnapshot().jobs).toHaveLength(2);
    generations.get("operation-2")?.resolve({
      fileName: "forest.png",
      filePath: "/tmp/forest.png",
      appPath: "app",
      appId: 7,
      appName: "App",
    });
    await flush();

    expect(
      actorA.getSnapshot().jobs.find((job) => job.id === "job-1")?.status,
    ).toBe("pending");
    expect(
      actorA.getSnapshot().jobs.find((job) => job.id === "job-2")?.status,
    ).toBe("success");
    expect(
      imageGenerationOperationService.inspect().unresolved,
    ).toBeGreaterThan(0);
  });

  it("requires the active invocation for cancellation", async () => {
    service.generate.mockReturnValue(new Promise(() => undefined));
    const { actorA, actorB } = createHarness();
    await actorA.resync();
    await actorB.resync();
    await actorA.dispatch(submit);
    const activeInvocationRef =
      actorA.getSnapshot().jobs[0]?.activeInvocationRef;
    if (!activeInvocationRef) throw new Error("missing invocation");

    await expect(
      actorB.dispatch({
        type: "CANCEL_REQUESTED",
        jobId: "job-1",
        activeInvocationRef,
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "unauthorized" });
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

  it("classifies a missing target app as not found", async () => {
    database.findFirst.mockResolvedValue(undefined);

    await expect(
      imageGenerationDefinition.remote.authorizeDispatch({
        sender: { webContentsId: 1 },
        key: getImageGenerationKey(),
        event: submit,
        currentState: { jobs: [] },
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Target app not found",
    });
  });

  it("refuses admission captured before an app-deletion fence is published", async () => {
    const authorization = deferred<{ id: number } | undefined>();
    database.findFirst.mockReturnValue(authorization.promise);
    const { actorA, host } = createHarness();
    await actorA.resync();

    const dispatch = actorA.dispatch(submit);
    await flush();
    const fence = host.beginFence(imageGenerationDefinition, {
      key: getImageGenerationKey(),
      allowDuringDrain: (event) => event.type !== "SUBMIT",
    });
    authorization.resolve({ id: 7 });

    await expect(dispatch).resolves.toMatchObject({ kind: "rejected" });
    expect(
      imageGenerationOperationService.registry.ticketFor(
        submit.requestId,
        () => true,
      ),
    ).toBeUndefined();
    expect(fence.abort()).toBe(true);
  });

  it("settles cancellation during provider execution as a typed non-error outcome", async () => {
    const generation = deferred<never>();
    service.generate.mockReturnValue(generation.promise);
    service.cancel.mockReturnValue(true);
    const { actorA } = createHarness();
    await actorA.resync();
    await actorA.dispatch(submit);
    const activeInvocationRef =
      actorA.getSnapshot().jobs[0]?.activeInvocationRef;
    if (!activeInvocationRef) throw new Error("missing invocation");

    await actorA.dispatch({
      type: "CANCEL_REQUESTED",
      jobId: "job-1",
      activeInvocationRef,
    });
    await vi.waitFor(() => expect(service.cancel).toHaveBeenCalledOnce());
    generation.reject(
      new DyadError("Image generation cancelled", DyadErrorKind.UserCancelled),
    );
    await vi.waitFor(() =>
      expect(actorA.getSnapshot().jobs[0]?.status).toBe("cancelled"),
    );
    await expect(
      imageGenerationOperationService.registry.ticketFor(
        submit.requestId,
        () => true,
      )?.settled,
    ).resolves.toMatchObject({
      outcome: { kind: "cancelled", jobId: "job-1" },
    });
  });

  it("settles a provider failure only after authoritative admission", async () => {
    service.generate.mockRejectedValue(
      new DyadError("Provider quota exhausted", DyadErrorKind.External),
    );
    const { actorA } = createHarness();
    await actorA.resync();

    await expect(actorA.dispatch(submit)).resolves.toMatchObject({
      kind: "applied",
    });
    await flush();

    expect(actorA.getSnapshot().jobs[0]).toMatchObject({
      status: "error",
      error: "Provider quota exhausted",
    });
    await expect(
      imageGenerationOperationService.registry.ticketFor(
        submit.requestId,
        () => true,
      )?.settled,
    ).resolves.toMatchObject({
      outcome: {
        kind: "failed",
        failureKind: "provider",
        message: "Provider quota exhausted",
      },
    });
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

  it("prunes terminal jobs after 30 minutes while retaining the collection", async () => {
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
      host
        .peek(imageGenerationDefinition.id, getImageGenerationKey())
        ?.getSnapshot(),
    ).toEqual({ jobs: [] });
    await expect(
      actorA.dispatch({
        ...submit,
        job: { ...submit.job, id: "job-2" },
        requestId: "request-2" as RequestId,
        operationId: "operation-2",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
  });
});
