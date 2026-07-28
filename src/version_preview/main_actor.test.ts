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
import { versionPreviewDefinition } from "@/ipc/services/version_preview_definition";
import { versionPreviewClientDefinition } from "./client_definition";
import { versionPreviewKey } from "./transport";
import { isMutatingState } from "./state";

const service = vi.hoisted(() => ({
  resolveOriginBranch: vi.fn(),
  run: vi.fn(),
  reconcile: vi.fn(),
  settle: vi.fn(async () => undefined),
  assertAcceptingOperations: vi.fn(),
  assertReadyForIntent: vi.fn(),
  beginReconciliation: vi.fn(),
  endReconciliation: vi.fn(),
  trackLifecycle: vi.fn((_appId: number, promise: Promise<unknown>) => promise),
}));
const presentation = vi.hoisted(() => ({
  recordInitiator: vi.fn(),
  publishResult: vi.fn(),
  publishError: vi.fn(),
  originEndpointFor: vi.fn(),
  forget: vi.fn(),
  confirm: vi.fn(),
}));
const invalidations = vi.hoisted(() => ({ publish: vi.fn() }));
const appRun = vi.hoisted(() => ({
  executeExternalLifecycle: vi.fn(async () => undefined),
}));
const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 7 })),
}));
const persistence = vi.hoisted(() => ({
  load: vi.fn((): any => ({ type: "closed" })),
  schedule: vi.fn(),
  checkpoint: vi.fn(),
  flush: vi.fn(),
  remove: vi.fn(),
  removeAll: vi.fn(),
}));

vi.mock("@/ipc/services/version_preview_service", () => ({
  versionPreviewService: service,
}));
vi.mock("@/ipc/services/version_preview_persistence", () => ({
  versionPreviewPersistence: persistence,
}));
vi.mock("@/ipc/services/version_preview_presentation_service", () => ({
  versionPreviewPresentationService: presentation,
}));
vi.mock("@/ipc/services/app_run_actor_service", () => ({
  appRunActorService: appRun,
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
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createHarness() {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
  });
  const manifest = createRemoteMachineManifest([versionPreviewDefinition]);
  const windows = new TwoWindowHarness();
  const transportErrors: unknown[] = [];
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
    onError: (error) => transportErrors.push(error),
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  const connectionA = duplex.connect();
  const connectionB = duplex.connect();
  const errors: unknown[] = [];
  const clientA = new RemoteMachineClient(
    connectionA,
    createSequentialIdSource(),
    (error) => errors.push(error),
  );
  const clientB = new RemoteMachineClient(
    connectionB,
    createSequentialIdSource(),
    (error) => errors.push(error),
  );
  clientA.start();
  clientB.start();
  const actorA = clientA.actor(
    versionPreviewClientDefinition,
    versionPreviewKey(7),
  );
  const actorB = clientB.actor(
    versionPreviewClientDefinition,
    versionPreviewKey(7),
  );
  const releaseA = actorA.subscribe(() => undefined);
  const releaseB = actorB.subscribe(() => undefined);
  return {
    actorA,
    actorB,
    clientA,
    clientB,
    connectionA,
    errors,
    host,
    releaseA,
    releaseB,
    transport,
    transportErrors,
  };
}

describe("version_preview main actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.findFirst.mockResolvedValue({ id: 7 });
    persistence.load.mockReturnValue({ type: "closed" });
    persistence.checkpoint.mockImplementation(() => undefined);
  });

  it("continues checkout after the initiating window closes and reattaches", async () => {
    const origin = deferred<{ branch: string | null }>();
    const checkout = deferred<{
      repositoryOutcome: "target-applied";
      notification: null;
      runtimeAction: "none";
      affectedChatId: null;
      createdChatId: null;
    }>();
    service.resolveOriginBranch.mockReturnValue(origin.promise);
    service.run.mockReturnValue(checkout.promise);
    const harness = createHarness();
    await harness.actorA.resync();
    await harness.actorB.resync();
    expect(harness.transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({ totalReferences: 2 }),
    ]);

    const receipt = await harness.actorA.dispatch({
      type: "SELECT_VERSION",
      versionId: "abc123",
      operationId: "preview-1",
    });
    expect(receipt.kind).toBe("applied");
    await flush();
    expect(
      (
        harness.host.peek(
          versionPreviewDefinition.id,
          versionPreviewKey(7),
        ) as any
      ).getSnapshot().state.type,
    ).toBe("resolving-origin");
    expect(harness.errors).toEqual([]);
    expect(harness.transportErrors).toEqual([]);
    expect(harness.actorA.getSnapshot().state.type).toBe("resolving-origin");
    origin.resolve({ branch: "feature/origin" });
    await flush();
    expect(harness.actorB.getSnapshot().state.type).toBe("checking-out");
    // ChatHeader's A2 mutation indicator consumes this exact remote state.
    expect(isMutatingState(harness.actorB.getSnapshot().state)).toBe(true);

    harness.releaseA();
    harness.clientA.dispose();
    checkout.resolve({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    await flush();
    expect(harness.actorB.getSnapshot().state).toMatchObject({
      type: "previewing",
      session: {
        originBranch: "feature/origin",
        checkedOutVersionId: "abc123",
      },
    });
    expect(presentation.forget).toHaveBeenCalledWith("preview-1");

    harness.releaseB();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("preserves the return branch until a close during checkout settles", async () => {
    service.resolveOriginBranch.mockResolvedValue({
      branch: "feature/origin",
    });
    const checkout = deferred<any>();
    const returned = deferred<any>();
    service.run
      .mockReturnValueOnce(checkout.promise)
      .mockReturnValueOnce(returned.promise);
    const harness = createHarness();
    await harness.actorA.resync();
    await harness.actorB.resync();

    await harness.actorA.dispatch({
      type: "SELECT_VERSION",
      versionId: "abc123",
      operationId: "preview-1",
    });
    await flush();
    expect(harness.actorB.getSnapshot().state.type).toBe("checking-out");
    const closeReceipt = await harness.actorB.dispatch({
      type: "CLOSE",
      operationId: "close-1",
    });
    expect(closeReceipt.kind).toBe("applied");
    expect(presentation.forget).toHaveBeenCalledWith("close-1");
    expect(presentation.forget).not.toHaveBeenCalledWith("preview-1");
    await flush();
    checkout.resolve({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    await flush();

    expect(service.run).toHaveBeenLastCalledWith(
      {
        type: "return",
        appId: 7,
        branch: "feature/origin",
      },
      "preview-1",
    );
    returned.resolve({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    await flush();
    expect(harness.actorA.getSnapshot().state.type).toBe("closed");
    expect(presentation.forget).toHaveBeenCalledWith("preview-1");

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("retires select and exit routing when close wins during origin resolution", async () => {
    const origin = deferred<{ branch: string | null }>();
    service.resolveOriginBranch.mockReturnValue(origin.promise);
    const harness = createHarness();
    await harness.actorA.resync();

    await harness.actorA.dispatch({
      type: "SELECT_VERSION",
      versionId: "abc123",
      operationId: "preview-1",
    });
    expect(harness.actorA.getSnapshot().state.type).toBe("resolving-origin");

    await harness.actorA.dispatch({
      type: "CLOSE",
      operationId: "close-1",
    });
    expect(harness.actorA.getSnapshot()).toMatchObject({
      state: { type: "closed" },
      activeInvocationRef: null,
    });
    expect(presentation.forget).toHaveBeenCalledWith("preview-1");
    expect(presentation.forget).toHaveBeenCalledWith("close-1");

    origin.resolve({ branch: "feature/origin" });
    await flush();
    expect(harness.actorA.getSnapshot().state.type).toBe("closed");
    expect(service.run).not.toHaveBeenCalled();

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("does not exhaust routing capacity across repeated early exits", async () => {
    service.resolveOriginBranch.mockImplementation(
      () => new Promise(() => undefined),
    );
    const routes = new Set<string>();
    presentation.recordInitiator.mockImplementation((operationId: string) => {
      if (routes.size >= 256) throw new Error("routing capacity exhausted");
      routes.add(operationId);
    });
    presentation.forget.mockImplementation((operationId: string) => {
      routes.delete(operationId);
    });
    const harness = createHarness();
    await harness.actorA.resync();

    try {
      for (let index = 0; index < 300; index += 1) {
        await harness.actorA.dispatch({
          type: "SELECT_VERSION",
          versionId: `version-${index}`,
          operationId: `preview-${index}`,
        });
        await harness.actorA.dispatch({
          type: "CLOSE",
          operationId: `close-${index}`,
        });
      }
      expect(routes).toEqual(new Set());
      expect(harness.actorA.getSnapshot().state.type).toBe("closed");
    } finally {
      presentation.recordInitiator.mockImplementation(() => undefined);
      presentation.forget.mockImplementation(() => undefined);
      harness.releaseA();
      harness.releaseB();
      harness.clientA.dispose();
      harness.clientB.dispose();
      harness.transport.dispose();
    }
  });

  it("publishes an origin-resolution error before releasing its initiator", async () => {
    service.resolveOriginBranch.mockResolvedValue({ branch: null });
    const presentationOrder: string[] = [];
    presentation.publishError.mockImplementationOnce(() => {
      presentationOrder.push("publish-error");
    });
    presentation.forget.mockImplementation((operationId: string) => {
      if (operationId === "preview-1") presentationOrder.push("forget");
    });
    const harness = createHarness();
    await harness.actorA.resync();

    try {
      await harness.actorA.dispatch({
        type: "SELECT_VERSION",
        versionId: "abc123",
        operationId: "preview-1",
      });
      await flush();

      expect(presentation.publishError).toHaveBeenCalledWith(
        7,
        "preview-1",
        expect.stringMatching(/current Git branch/i),
      );
      expect(presentationOrder).toEqual(["publish-error", "forget"]);
      expect(harness.actorA.getSnapshot().state.type).toBe("browsing");
    } finally {
      harness.releaseA();
      harness.releaseB();
      harness.clientA.dispose();
      harness.clientB.dispose();
      harness.transport.dispose();
    }
  });

  it("reconciles an interrupted persisted checkout against repository truth", async () => {
    persistence.load.mockReturnValue({
      type: "checking-out",
      session: {
        appId: 7,
        originBranch: "feature/origin",
        targetVersionId: "abc123",
        checkedOutVersionId: null,
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    });
    service.reconcile.mockResolvedValue({ branch: null });
    const harness = createHarness();
    await harness.actorA.resync();
    expect(service.beginReconciliation).toHaveBeenCalledWith(7);
    await flush();

    expect(harness.actorA.getSnapshot().state).toMatchObject({
      type: "recovery-required",
      session: { originBranch: "feature/origin" },
    });
    const reconciled = harness.actorA.getSnapshot().state;
    expect(
      reconciled.type === "recovery-required" && reconciled.error.message,
    ).toMatch(/restarted during a version checkout/);
    expect(service.endReconciliation).toHaveBeenCalledWith(7);

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("closes an interrupted live-branch restore without inventing a return branch", async () => {
    persistence.load.mockReturnValue({
      type: "restoring",
      fallback: "closed",
      session: {
        appId: 7,
        originBranch: null,
        targetVersionId: "abc123",
        checkedOutVersionId: null,
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    });
    service.reconcile.mockResolvedValue({ branch: "main" });
    const harness = createHarness();
    await harness.actorA.resync();
    await flush();

    expect(harness.actorA.getSnapshot().state.type).toBe("closed");
    expect(service.run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "return", branch: "" }),
      expect.anything(),
    );

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("keeps recovery when an interrupted branch switch lands elsewhere", async () => {
    persistence.load.mockReturnValue({
      type: "switching-branch",
      appId: 7,
      branch: "requested-branch",
      fallback: {
        type: "previewing",
        session: {
          appId: 7,
          originBranch: "feature/origin",
          targetVersionId: "abc123",
          checkedOutVersionId: "abc123",
          exitIntent: { type: "none" },
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      },
    });
    service.reconcile.mockResolvedValue({ branch: "unrelated-branch" });
    const harness = createHarness();
    await harness.actorA.resync();
    await flush();

    expect(harness.actorA.getSnapshot().state).toMatchObject({
      type: "recovery-required",
      session: { originBranch: "feature/origin" },
    });

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });

  it("does not start Git mutation when the recovery checkpoint fails", async () => {
    service.resolveOriginBranch.mockResolvedValue({
      branch: "feature/origin",
    });
    persistence.checkpoint.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const harness = createHarness();
    await harness.actorA.resync();

    await harness.actorA.dispatch({
      type: "SELECT_VERSION",
      versionId: "abc123",
      operationId: "preview-checkpoint-failure",
    });
    await flush();

    expect(service.run).not.toHaveBeenCalled();
    expect(harness.actorA.getSnapshot().state.type).toBe("browsing");
    expect(presentation.publishError).toHaveBeenCalledWith(
      7,
      "preview-checkpoint-failure",
      expect.stringContaining("disk full"),
    );

    harness.releaseA();
    harness.releaseB();
    harness.clientA.dispose();
    harness.clientB.dispose();
    harness.transport.dispose();
  });
});
