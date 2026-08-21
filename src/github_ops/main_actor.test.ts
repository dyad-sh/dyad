import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import type { HostedActorRef } from "@/distributed_machines/definition";
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
  CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS,
  githubOpsDefinition,
} from "@/ipc/services/github_ops_definition";
import { githubOpsClientDefinition } from "./client_definition";
import { MAX_GITHUB_OPS_VERIFICATION_ERROR_LENGTH } from "./error_message";
import type { GithubOpsIgnoreReason } from "./state";
import {
  githubOpsKey,
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
  settle: vi.fn<() => Promise<void>>(async () => undefined),
  assertAcceptingOperations: vi.fn(),
}));

const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 7 }) as { id: number } | undefined),
}));
const invalidations = vi.hoisted(() => ({ publish: vi.fn() }));
const presentation = vi.hoisted(() => ({
  dismissError: vi.fn(),
  forget: vi.fn(),
  recordInitiator: vi.fn(),
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

describe("main-hosted github_ops actor", () => {
  beforeEach(() => {
    service.run.mockReset();
    service.getGitState.mockReset();
    service.getConflicts.mockReset();
    service.settle.mockReset();
    service.settle.mockResolvedValue(undefined);
    service.assertAcceptingOperations.mockReset();
    database.findFirst.mockReset();
    invalidations.publish.mockReset();
    presentation.forget.mockReset();
    presentation.recordInitiator.mockReset();
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

    const receipt = await actorA.dispatch({
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

  it("reattaches after a mid-rebase window close while work continues", async () => {
    const pending = deferred();
    service.run.mockReturnValue(pending.promise);
    const { actorA, clientA, duplex, host, releaseA } = createHarness();
    await actorA.resync();
    await actorA.dispatch({
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
      actor.dispatch({
        type: "CONFLICT_RESOLUTION_STARTED",
        claimId: "missing-claim",
        chatId: 42,
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "stale-operation",
    });
    await expect(
      actor.dispatch({
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-after-sync",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      actor.dispatch({
        type: "CONFLICT_RESOLUTION_STARTED",
        claimId: "claim-after-sync",
        chatId: 42,
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

    const receipt = await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });
    expect(receipt.kind).toBe("applied");
    expect(actorA.getSnapshot().state.type).toBe("conflicted");
    expect(service.run).not.toHaveBeenCalled();
    await expect(
      actorB.dispatch({
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-b",
      }),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "invalid-in-current-state",
    });

    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_STARTED",
      claimId: "claim-a",
      chatId: 42,
    });
    expect(actorA.getSnapshot().state).toMatchObject({
      type: "conflicted",
      resolution: "resolving",
    });
  });

  it("continues a resolved rebase conflict before pushing", async () => {
    service.getGitState.mockResolvedValue({
      mergeInProgress: false,
      rebaseInProgress: true,
    });
    const { actorA, host } = createHarness();
    await actorA.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: true,
    });
    await flush();
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();

    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "rebase-claim",
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_STARTED",
      claimId: "rebase-claim",
      chatId: 42,
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 42,
    });
    await flush();
    expect(actorA.getSnapshot().state).toMatchObject({
      type: "conflicted",
      origin: { type: "rebase" },
      resolution: "ready-to-sync",
    });

    await actorA.dispatch({
      type: "OP_REQUESTED",
      op: { type: "rebase-continue" },
      operationId: "continue-rebase-and-push",
    });
    await flush();

    expect(service.run).toHaveBeenNthCalledWith(1, 7, {
      type: "rebase-continue",
    });
    expect(service.run).toHaveBeenNthCalledWith(2, 7, {
      type: "push",
      mode: "normal",
    });
    expect(actorA.getSnapshot().state.type).toBe("idle");
  });

  it("makes a failed Git-state verification retryable without restarting AI", async () => {
    service.getGitState.mockRejectedValueOnce(
      new Error("temporary Git-state failure"),
    );
    const { actorA, host } = createHarness();
    await actorA.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();

    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "verification-claim",
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_STARTED",
      claimId: "verification-claim",
      chatId: 42,
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 42,
    });
    await flush();

    expect(actorA.getSnapshot().state).toMatchObject({
      type: "conflicted",
      resolution: "verification-failed",
      resolutionChatId: 42,
      verificationError: "temporary Git-state failure",
    });
    expect(presentation.showError).not.toHaveBeenCalled();

    await actorA.dispatch({ type: "RETRY_CONFLICT_VERIFICATION" });
    await flush();

    expect(service.getGitState).toHaveBeenCalledTimes(2);
    expect(actorA.getSnapshot().state).toMatchObject({
      type: "idle",
      banner: {
        kind: "success",
        message: "Merge conflicts resolved.",
      },
    });
  });

  it("makes a failed conflict-file verification retryable", async () => {
    const verboseProbeFailure = "x".repeat(
      MAX_GITHUB_OPS_VERIFICATION_ERROR_LENGTH + 500,
    );
    service.getConflicts.mockRejectedValueOnce(new Error(verboseProbeFailure));
    const { actorA, host } = createHarness();
    await actorA.resync();
    const local: GithubOpsHostedActor = host.ensure(
      githubOpsDefinition,
      githubOpsKey(7),
    );
    local.send({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
    await flush();

    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "conflict-probe-claim",
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_STARTED",
      claimId: "conflict-probe-claim",
      chatId: 42,
    });
    await actorA.dispatch({
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 42,
    });
    await flush();

    expect(service.getConflicts).toHaveBeenCalledOnce();
    const failedSnapshot = actorA.getSnapshot();
    expect(failedSnapshot.state).toMatchObject({
      type: "conflicted",
      resolution: "verification-failed",
      resolutionChatId: 42,
    });
    expect(
      failedSnapshot.state.type === "conflicted"
        ? failedSnapshot.state.verificationError
        : undefined,
    ).toHaveLength(MAX_GITHUB_OPS_VERIFICATION_ERROR_LENGTH);
    expect(
      failedSnapshot.state.type === "conflicted"
        ? failedSnapshot.state.verificationError
        : undefined,
    ).toMatch(/\n… \[GitHub error output truncated\]$/);
    expect(presentation.showError).not.toHaveBeenCalled();

    await actorA.dispatch({ type: "RETRY_CONFLICT_VERIFICATION" });
    await flush();

    expect(service.getConflicts).toHaveBeenCalledTimes(2);
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

    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });
    await actorB.dispatch({ type: "RECONCILE_REQUESTED" });

    expect(actorB.getSnapshot().conflictResolutionClaimed).toBe(true);
    await expect(
      actorB.dispatch({
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

    await actorA.dispatch({
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
          chatId: 42,
        },
        messageId: "stale-claim-follow-up",
        expectedActorInstanceId: local.actorInstanceId,
        expectedRevision: staleRevision,
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(local.getSnapshot().state).toMatchObject({
      type: "conflicted",
      resolution: "resolving",
    });
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
    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "claim-a",
    });

    await expect(
      actorB.dispatch({
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
    await actorA.dispatch({
      type: "RESOLVE_WITH_AI_STARTED",
      claimId: "abandoned-claim",
    });

    releaseA();
    clientA.dispose();
    clock.advanceBy(CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS);
    await flush();

    expect(local.getSnapshot().conflictResolutionClaimId).toBeNull();
    await expect(
      actorB.dispatch({
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

    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
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

    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
    await flush();
    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
    await flush();
    rejectConflicts(new Error("superseded conflict failure"));
    await flush();

    expect(presentation.showError).not.toHaveBeenCalled();
  });

  it("shows a toast for a generic probe failure without emitting verification recovery", async () => {
    service.getGitState.mockRejectedValueOnce(
      new Error("temporary repository refresh failure"),
    );
    const { actorA } = createHarness();
    await actorA.resync();

    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
    await flush();

    expect(actorA.getSnapshot().state.type).toBe("idle");
    expect(presentation.showError).toHaveBeenCalledExactlyOnceWith(
      7,
      undefined,
      "temporary repository refresh failure",
    );
  });

  it("preserves detailed generic probe failures beyond the verification-event bound", async () => {
    const detailedMessage = Array.from(
      { length: 80 },
      (_, index) => `repository refresh detail ${index}`,
    ).join("\n");
    service.getGitState.mockRejectedValueOnce(new Error(detailedMessage));
    const { actorA } = createHarness();
    await actorA.resync();

    await actorA.dispatch({ type: "RECONCILE_REQUESTED" });
    await flush();

    expect(detailedMessage.length).toBeGreaterThan(
      MAX_GITHUB_OPS_VERIFICATION_ERROR_LENGTH,
    );
    expect(presentation.showError).toHaveBeenCalledExactlyOnceWith(
      7,
      undefined,
      detailedMessage,
    );
  });

  it("rejects dispatch for the null-app subscription sentinel", async () => {
    const { clientA } = createHarness();
    const sentinel = clientA.actor(githubOpsClientDefinition, githubOpsKey(0));
    const release = sentinel.subscribe(() => undefined);
    await sentinel.resync();

    await expect(
      sentinel.dispatch({
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
    service.settle.mockReturnValue(settlement.promise);
    const { actorA, host } = createHarness();
    await actorA.resync();

    let disposed = false;
    const disposal = host
      .disposeKey(githubOpsDefinition.id, githubOpsKey(7), "entity-deletion")
      .then(() => {
        disposed = true;
      });
    await vi.waitFor(() => expect(service.settle).toHaveBeenCalledWith(7));
    expect(disposed).toBe(false);

    settlement.resolve();
    await disposal;
    expect(disposed).toBe(true);
  });

  it("redacts repository paths while preserving Git failure details", async () => {
    service.run.mockRejectedValue(
      new Error(
        "fatal: Unable to create '/Users/alice/apps/demo/.git/index.lock'",
      ),
    );
    const { actorA } = createHarness();
    await actorA.resync();
    await actorA.dispatch({
      type: "OP_REQUESTED",
      operationId: "unsafe-error",
      op: { type: "push", mode: "normal" },
    });
    await vi.waitFor(() =>
      expect(actorA.getSnapshot().state).toMatchObject({
        type: "idle",
        banner: {
          kind: "error",
          message: "fatal: Unable to create '[redacted path]'",
        },
      }),
    );
  });
});
