import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import type { HostedActorRef } from "@/distributed_machines/definition";
import {
  RemoteMachineClient,
  type RemoteActorRef,
} from "@/distributed_machines/remote_client";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import { FakeDuplexRemoteTransport } from "@/distributed_machines/testing";
import type {
  RequestId,
  RequestIdempotencyKey,
  RequestMessageId,
} from "@/distributed_machines/request_identity";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import {
  CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS,
  githubOpsDefinition,
} from "@/ipc/services/github_ops_definition";
import { GithubOpsActorService } from "@/ipc/services/github_ops_actor_service";
import { githubOpsOperationService } from "@/ipc/services/github_ops_operation_service";
import { githubOpsClientDefinition } from "./client_definition";
import type { GithubOpsIgnoreReason } from "./state";
import {
  GITHUB_OPS_INVOCATION_KIND,
  githubOpsKey,
  type GithubOpsIntentEvent,
  type GithubOpsRemoteSnapshot,
  type GithubOpsActorState,
  type GithubOpsWireEvent,
} from "./transport";

const service = vi.hoisted(() => ({
  run: vi.fn<() => Promise<void>>(),
  getGitState:
    vi.fn<
      () => Promise<{ mergeInProgress: boolean; rebaseInProgress: boolean }>
    >(),
  getConflicts: vi.fn<() => Promise<string[]>>(),
}));

const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 7 }) as { id: number } | undefined),
}));
const invalidations = vi.hoisted(() => ({ publish: vi.fn() }));
const presentation = vi.hoisted(() => ({
  markTerminal: vi.fn(),
  recordInitiator: vi.fn(),
  releaseOwner: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/ipc/services/github_ops_service", () => ({
  githubOpsService: service,
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
vi.mock("@/ipc/services/github_ops_presentation_service", () => ({
  githubOpsPresentationService: presentation,
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
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
  const manifest = createRemoteMachineManifest([githubOpsDefinition]);
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
  const actorA = clientA.actor(githubOpsClientDefinition, githubOpsKey(7));
  const actorB = clientB.actor(githubOpsClientDefinition, githubOpsKey(7));
  const releaseA = actorA.subscribe(() => undefined);
  const releaseB = actorB.subscribe(() => undefined);
  return {
    actorA,
    actorB,
    clock,
    clientA,
    clientB,
    connectionA,
    connectionB,
    duplex,
    host,
    releaseA,
    releaseB,
    transport,
  };
}

type GithubOpsHostedActor = HostedActorRef<
  GithubOpsActorState,
  GithubOpsWireEvent,
  GithubOpsIgnoreReason | "stale-operation"
>;

function dispatchCurrent(
  actor: RemoteActorRef<GithubOpsRemoteSnapshot, GithubOpsIntentEvent, string>,
  event: GithubOpsIntentEvent,
) {
  const snapshot = actor.getView().snapshot;
  return actor.dispatch(
    event,
    snapshot.kind === "available"
      ? { expected: snapshot.observedRevision }
      : undefined,
  );
}

describe("main-hosted github_ops actor integration", () => {
  beforeEach(() => {
    service.run.mockReset();
    service.getGitState.mockReset();
    service.getConflicts.mockReset();
    database.findFirst.mockReset();
    invalidations.publish.mockReset();
    presentation.markTerminal.mockReset();
    presentation.recordInitiator.mockReset();
    presentation.releaseOwner.mockReset();
    presentation.showError.mockReset();
    database.findFirst.mockResolvedValue({ id: 7 });
    service.run.mockResolvedValue(undefined);
    service.getGitState.mockResolvedValue({
      mergeInProgress: false,
      rebaseInProgress: false,
    });
    service.getConflicts.mockResolvedValue([]);
  });

  it("shares one mutation across two windows and retains it after the initiating window closes", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA, actorB, clientA, releaseA, releaseB, transport } =
      createHarness();
    await actorA.resync();
    await actorB.resync();

    const receipt = await dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      op: { type: "pull" },
      operationId: "pull-a",
    });
    expect(receipt.kind).toBe("applied");
    expect(actorB.getSnapshot().state).toMatchObject({
      type: "running",
      op: { type: "pull" },
    });
    expect(service.run).toHaveBeenCalledOnce();

    releaseA();
    clientA.dispose();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);
    pending.resolve();
    await flush();

    expect(actorB.getSnapshot().state.type).toBe("idle");
    expect(invalidations.publish).toHaveBeenCalledWith([
      { family: "branches", appId: 7 },
      { family: "versions", appId: 7 },
    ]);
    expect(invalidations.publish).toHaveBeenCalledWith([
      { family: "app", appId: 7 },
      { family: "apps" },
    ]);
    releaseB();
  });

  it("delivers authoritative success through the protocol-v1 operation adapter", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA } = createHarness();
    await actorA.resync();
    const settlement = new Promise<unknown>((resolve) => {
      actorA.subscribeOperationOutcome("tracked-success", resolve);
    });

    await dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      operationId: "tracked-success",
      op: { type: "push", mode: "normal" },
    });
    pending.resolve();

    await expect(settlement).resolves.toEqual({
      kind: "succeeded",
      operation: "push",
    });
  });

  it("coalesces and replays a stable request after the actor revision advances", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA } = createHarness();
    await actorA.resync();
    const snapshot = actorA.getView().snapshot;
    if (snapshot.kind !== "available") throw new Error("actor unavailable");
    const intent = {
      type: "OP_REQUESTED" as const,
      operationId: "duplicate-operation",
      op: { type: "push" as const, mode: "normal" as const },
    };
    const requestId = "duplicate-request" as RequestId;
    const idempotencyKey = "duplicate-idempotency" as RequestIdempotencyKey;
    const dispatch = (messageId: string) =>
      actorA.dispatch(intent, {
        expected: snapshot.observedRevision,
        requestIdentity: {
          requestId,
          messageId: messageId as RequestMessageId,
          idempotencyKey,
          windowSessionId: "renderer-session",
        },
      });

    await expect(dispatch("message-1")).resolves.toMatchObject({
      kind: "applied",
    });
    await expect(dispatch("message-2")).resolves.toMatchObject({
      kind: "applied",
    });
    expect(service.run).toHaveBeenCalledOnce();

    pending.resolve();
    await vi.waitFor(() =>
      expect(actorA.getSnapshot().state.type).toBe("idle"),
    );
    await expect(dispatch("message-3")).resolves.toMatchObject({
      kind: "applied",
    });
    expect(service.run).toHaveBeenCalledOnce();
  });

  it("replays a completed abort before rechecking its cleared active invocation", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA, host } = createHarness();
    await actorA.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    const activeInvocationRef = {
      kind: GITHUB_OPS_INVOCATION_KIND,
      entityKey: 7,
      operationId: "recovered-rebase",
    } as const;
    local.send({
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: true,
      recoveryInvocationRef: activeInvocationRef,
    });
    await flush();
    const snapshot = actorA.getView().snapshot;
    if (snapshot.kind !== "available") throw new Error("actor unavailable");
    const intent = {
      type: "OP_REQUESTED" as const,
      operationId: "renderer-abort",
      op: { type: "rebase-abort" as const },
      activeInvocationRef,
    };
    const requestId = "abort-request" as RequestId;
    const idempotencyKey = "abort-idempotency" as RequestIdempotencyKey;
    const dispatch = (messageId: string) =>
      actorA.dispatch(intent, {
        expected: snapshot.observedRevision,
        requestIdentity: {
          requestId,
          messageId: messageId as RequestMessageId,
          idempotencyKey,
          windowSessionId: "renderer-session",
        },
      });

    await expect(dispatch("abort-message-1")).resolves.toMatchObject({
      kind: "applied",
    });
    pending.resolve();
    await vi.waitFor(() =>
      expect(actorA.getSnapshot().state.type).toBe("idle"),
    );

    await expect(dispatch("abort-message-2")).resolves.toMatchObject({
      kind: "applied",
    });
    expect(service.run).toHaveBeenCalledOnce();
  });

  it("rejects an authorization result after the app actor is replaced", async () => {
    const { actorA, host } = createHarness();
    await actorA.resync();
    const authorizationCalls = database.findFirst.mock.calls.length;
    let authorize!: (app: { id: number }) => void;
    database.findFirst.mockReturnValueOnce(
      new Promise((resolve) => {
        authorize = resolve;
      }),
    );
    const dispatch = dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      operationId: "authorization-race",
      op: { type: "push", mode: "normal" },
    });
    await vi.waitFor(() =>
      expect(database.findFirst.mock.calls.length).toBeGreaterThan(
        authorizationCalls,
      ),
    );
    await host.disposeKey(
      githubOpsDefinition.id,
      githubOpsKey(7),
      "entity-deletion",
    );
    host.ensure(githubOpsDefinition, githubOpsKey(7));
    authorize({ id: 7 });

    await expect(dispatch).resolves.toMatchObject({
      kind: "rejected",
      reason: "stale-actor",
    });
    expect(service.run).not.toHaveBeenCalled();
    expect(githubOpsOperationService.inspect().unresolved).toBe(0);
  });

  it("fences GitHub intents during failed deletion and reopens only on abort", async () => {
    const { actorA, host } = createHarness();
    await actorA.resync();
    const deletion = new GithubOpsActorService(host).beginAppDeletion(7);
    await deletion.seal();

    await expect(
      dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "host-disposing",
    });
    expect(deletion.abort()).toBe(true);
    await expect(
      dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" }),
    ).resolves.toMatchObject({ kind: "applied" });
  });

  it("delivers tracked Git output through the new generation after deletion abort", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA, host } = createHarness();
    await actorA.resync();
    const deletion = new GithubOpsActorService(host).beginAppDeletion(7);
    await deletion.seal();
    expect(deletion.abort()).toBe(true);
    const settlement = new Promise<unknown>((resolve) => {
      actorA.subscribeOperationOutcome("post-abort-request", resolve);
    });

    const snapshot = actorA.getView().snapshot;
    if (snapshot.kind !== "available") throw new Error("actor unavailable");
    await actorA.dispatch(
      {
        type: "OP_REQUESTED",
        operationId: "renderer-operation",
        op: { type: "push", mode: "normal" },
      },
      {
        expected: snapshot.observedRevision,
        requestIdentity: {
          requestId: "post-abort-request" as RequestId,
          messageId: "post-abort-message" as RequestMessageId,
          idempotencyKey: "post-abort-key" as RequestIdempotencyKey,
          windowSessionId: "renderer-session",
        },
      },
    );
    pending.resolve();

    await expect(settlement).resolves.toEqual({
      kind: "succeeded",
      operation: "push",
    });
    expect(githubOpsOperationService.inspect().unresolved).toBe(0);
  });

  it("rearms a conflict claim lease after a failed deletion boundary", async () => {
    const { actorA, actorB, clock, host } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();
    await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-before-deletion",
    });
    const deletion = new GithubOpsActorService(host).beginAppDeletion(7);
    await deletion.seal();
    clock.advanceBy(CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS);
    await flush();
    expect(local.getSnapshot().conflictResolutionClaimId).toBe(
      "claim-before-deletion",
    );

    expect(deletion.abort()).toBe(true);
    clock.advanceBy(CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS);
    await flush();

    expect(local.getSnapshot().conflictResolutionClaimId).toBeNull();
    await expect(
      dispatchCurrent(actorB, {
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-after-deletion",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
  });

  it("reattaches after a mid-rebase window close while work continues", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA, clientA, duplex, host, releaseA } = createHarness();
    await actorA.resync();
    await dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      op: { type: "rebase" },
      operationId: "rebase-before-reload",
    });

    releaseA();
    clientA.dispose();
    const replacement = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    replacement.start();
    const reattached = replacement.actor(
      githubOpsClientDefinition,
      githubOpsKey(7),
    );
    const releaseReplacement = reattached.subscribe(() => undefined);
    await reattached.resync();
    expect(reattached.getSnapshot().state).toMatchObject({
      type: "running",
      op: { type: "rebase" },
    });

    pending.resolve();
    await flush();
    expect(reattached.getSnapshot().state.type).toBe("idle");
    expect(host.peek(githubOpsDefinition.id, githubOpsKey(7))).toBeDefined();
    releaseReplacement();
  });

  it("rejects a stale-revision request, then accepts it after sync", async () => {
    const { actorA: actor, connectionA: connection, host } = createHarness();
    await actor.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    const actorInstanceId = local.actorInstanceId;
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();

    await expect(
      connection.dispatch({
        protocolVersion: githubOpsClientDefinition.remote.protocolVersion,
        machineId: githubOpsClientDefinition.id,
        encodedKey: { appId: 7 },
        encodedEvent: {
          type: "BLOCKED_DISMISSED",
        },
        messageId: "stale-message",
        expectedActorInstanceId: actorInstanceId,
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });

    await actor.resync();
    await expect(
      dispatchCurrent(actor, {
        type: "CONFLICT_RESOLUTION_STARTED",
        claimId: "missing-claim",
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "stale-operation",
    });
    await expect(
      dispatchCurrent(actor, {
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-after-sync",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      dispatchCurrent(actor, {
        type: "CONFLICT_RESOLUTION_STARTED",
        claimId: "claim-after-sync",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
  });

  it("uses the applied receipt as the conflict-resolution handoff", async () => {
    const { actorA, actorB, host } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();
    expect(actorA.getSnapshot().state.type).toBe("conflicted");

    const receipt = await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });
    expect(receipt.kind).toBe("applied");
    expect(actorA.getSnapshot().state.type).toBe("conflicted");
    expect(service.run).not.toHaveBeenCalled();
    await expect(
      dispatchCurrent(actorB, {
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-b",
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "invalid-in-current-state",
    });

    await dispatchCurrent(actorA, {
      type: "CONFLICT_RESOLUTION_STARTED",
      claimId: "claim-a",
    });
    expect(actorA.getSnapshot().state.type).toBe("idle");
  });

  it("preserves the claim through reconcile and rejects a second window", async () => {
    service.getConflicts.mockResolvedValue(["src/conflicted.ts"]);
    const { actorA, actorB, host } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();

    await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });
    await dispatchCurrent(actorB, { type: "RECONCILE_REQUESTED" });

    expect(actorB.getSnapshot().conflictResolutionClaimed).toBe(true);
    await expect(
      dispatchCurrent(actorB, {
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-b",
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "invalid-in-current-state",
    });
  });

  it("accepts a claim-correlated follow-up with a stale revision", async () => {
    const { actorA, connectionA, host } = createHarness();
    await actorA.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();
    const staleRevision = actorA.getSnapshot().revision;

    await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });
    await expect(
      connectionA.dispatch({
        protocolVersion: githubOpsClientDefinition.remote.protocolVersion,
        machineId: githubOpsClientDefinition.id,
        encodedKey: { appId: 7 },
        encodedEvent: {
          type: "CONFLICT_RESOLUTION_STARTED",
          claimId: "claim-a",
        },
        messageId: "stale-claim-follow-up",
        expectedActorInstanceId: local.actorInstanceId,
        expectedRevision: staleRevision,
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(local.getSnapshot().state.type).toBe("idle");
  });

  it("rejects a follow-up from the wrong claimant", async () => {
    const { actorA, actorB, host } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();
    await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });

    await expect(
      dispatchCurrent(actorB, {
        type: "CONFLICT_RESOLUTION_CANCELLED",
        claimId: "claim-b",
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "stale-operation",
    });
    expect(local.getSnapshot().conflictResolutionClaimId).toBe("claim-a");
  });

  it("expires an abandoned claim so another window can reclaim it", async () => {
    const { actorA, actorB, clientA, clock, host, releaseA } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();
    await dispatchCurrent(actorA, {
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "abandoned-claim",
    });

    releaseA();
    clientA.dispose();
    clock.advanceBy(CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS);
    await flush();

    expect(local.getSnapshot().conflictResolutionClaimId).toBeNull();
    await expect(
      dispatchCurrent(actorB, {
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "replacement-claim",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
  });

  it("reconciles repository truth after actor recreation", async () => {
    service.getGitState.mockResolvedValue({
      mergeInProgress: false,
      rebaseInProgress: true,
    });
    const { actorA, host } = createHarness();
    await actorA.resync();
    await host.disposeKey(githubOpsDefinition.id, githubOpsKey(7));

    const replacement: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    replacement.send({ type: "RECONCILE_REQUESTED" });
    await flush();

    expect(service.getGitState).toHaveBeenCalledWith(7);
    expect(replacement.getSnapshot().state.type).toBe("rebase-paused");
  });

  it("suppresses failures from superseded repository probes", async () => {
    let rejectGitState!: (error: Error) => void;
    service.getGitState
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectGitState = reject;
        }),
      )
      .mockResolvedValue({
        mergeInProgress: false,
        rebaseInProgress: false,
      });
    const { actorA } = createHarness();
    await actorA.resync();

    await dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" });
    await dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" });
    rejectGitState(new Error("superseded Git-state failure"));
    await flush();

    expect(presentation.showError).not.toHaveBeenCalled();

    let rejectConflicts!: (error: Error) => void;
    service.getConflicts
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectConflicts = reject;
        }),
      )
      .mockResolvedValue([]);

    await dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" });
    await flush();
    await dispatchCurrent(actorA, { type: "RECONCILE_REQUESTED" });
    await flush();
    rejectConflicts(new Error("superseded conflict failure"));
    await flush();

    expect(presentation.showError).not.toHaveBeenCalled();
  });

  it("rejects dispatch for the null-app subscription sentinel", async () => {
    const { clientA } = createHarness();
    const sentinel = clientA.actor(githubOpsClientDefinition, githubOpsKey(0));
    const release = sentinel.subscribe(() => undefined);
    await sentinel.resync();

    await expect(
      dispatchCurrent(sentinel, {
        type: "OP_REQUESTED",
        operationId: "sentinel-operation",
        op: {
          type: "connect-repo",
          mode: "create",
          org: "acme",
          repo: "orphan",
          thenAutoPush: false,
        },
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "unauthorized",
    });
    expect(service.run).not.toHaveBeenCalled();
    release();
  });

  it("keeps actor disposal pending until admitted Git work settles", async () => {
    const settlement = deferred();
    service.run.mockReturnValue(settlement.promise);
    const { actorA, host } = createHarness();
    await actorA.resync();
    await dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      operationId: "pending-during-disposal",
      op: { type: "push", mode: "normal" },
    });

    let disposed = false;
    const disposal = host
      .disposeKey(githubOpsDefinition.id, githubOpsKey(7), "entity-deletion")
      .then(() => {
        disposed = true;
      });
    await vi.waitFor(() => expect(service.run).toHaveBeenCalledOnce());
    expect(disposed).toBe(false);

    settlement.resolve();
    await disposal;
    expect(disposed).toBe(true);
  });

  it("does not project repository paths from Git failures", async () => {
    service.run.mockRejectedValue(
      new Error(
        "fatal: Unable to create '/Users/alice/apps/demo/.git/index.lock'",
      ),
    );
    const { actorA } = createHarness();
    await actorA.resync();
    const settlement = new Promise<unknown>((resolve) => {
      actorA.subscribeOperationOutcome("unsafe-error", resolve);
    });
    await dispatchCurrent(actorA, {
      type: "OP_REQUESTED",
      operationId: "unsafe-error",
      op: { type: "push", mode: "normal" },
    });
    await vi.waitFor(() =>
      expect(actorA.getSnapshot().state).toMatchObject({
        type: "idle",
        banner: {
          kind: "error",
          message: "GitHub operation failed",
        },
      }),
    );
    await expect(settlement).resolves.toMatchObject({
      kind: "failed",
      operation: "push",
      failure: { kind: "external" },
    });
  });
});
