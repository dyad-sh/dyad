import { describe, expect, it, vi } from "vitest";
import { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { RemoteMachineTransportError } from "@/distributed_machines/remote_client";
import {
  createVersionPreviewRequestActor,
  observeVersionPreviewAdmission,
} from "./request_actor";

describe("createVersionPreviewRequestActor", () => {
  it("registers before dispatch and preserves observed revision and identity on retry", async () => {
    const observed = {
      kind: "actor",
      actorInstanceId: "actor",
      revision: 5,
    } as never;
    const scope = new PreparedRequestScope("window-session");
    let outcomeListener: ((outcome: unknown, actor: any) => void) | undefined;
    const releases: ReturnType<typeof vi.fn>[] = [];
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(
        new RemoteMachineTransportError("disconnected", "connection lost"),
      )
      .mockImplementationOnce(async (_intent, options) => {
        expect(scope.inspectActiveCount()).toBe(1);
        queueMicrotask(() => {
          outcomeListener?.(
            { kind: "succeeded", operation: "select-version" },
            {
              actorInstanceId: "actor",
              snapshotRevision: 5,
              transactionSequence: 2,
            },
          );
        });
        return {
          kind: "applied",
          actorInstanceId: "actor",
          revision: 5,
          transactionSequence: 2,
          messageId: options.requestIdentity.messageId,
        };
      });
    const actor = {
      retain: vi.fn(() => {
        const release = vi.fn();
        releases.push(release);
        return {
          ready: Promise.resolve(),
          refresh: vi.fn(async () => undefined),
          release,
        };
      }),
      getView: vi.fn(() => ({
        state: {
          appId: 7,
          revision: 5,
          state: { type: "closed" },
          activeInvocationRef: null,
          lastSettlement: null,
        },
        connection: "ready",
        snapshot: { kind: "available", observedRevision: observed },
      })),
      subscribe: vi.fn(() => () => undefined),
      subscribeOperationOutcome: vi.fn((_requestId, listener) => {
        outcomeListener = listener;
        return () => {
          outcomeListener = undefined;
        };
      }),
      dispatch,
    };
    const remote = { actor: vi.fn(() => actor) };
    const requestActor = createVersionPreviewRequestActor(
      remote as never,
      scope,
      7,
    );

    const request = requestActor.request({
      intent: {
        type: "SELECT_VERSION",
        versionId: "abc123",
        operationId: "select",
      },
      observed,
    });
    const onAdmitted = vi.fn();
    const observedAdmission = observeVersionPreviewAdmission(
      request,
      onAdmitted,
    );

    expect(scope.inspectActiveCount()).toBe(1);
    await expect(request.admission).resolves.toMatchObject({
      kind: "disconnected",
      retryable: true,
    });
    await expect(observedAdmission).resolves.toBeUndefined();
    expect(onAdmitted).toHaveBeenCalledOnce();
    await expect(request.settled).resolves.toEqual({
      kind: "completed",
      outcome: { kind: "succeeded", operation: "select-version" },
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    const firstOptions = dispatch.mock.calls[0][1];
    const secondOptions = dispatch.mock.calls[1][1];
    expect(firstOptions.expected).toStrictEqual(observed);
    expect(secondOptions.expected).toStrictEqual(observed);
    expect(secondOptions.requestIdentity).toEqual(firstOptions.requestIdentity);
    expect(releases).toHaveLength(2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
      true,
    );
    expect(scope.inspectActiveCount()).toBe(0);
  });

  it("detaches after an exhausted automatic retry instead of leaving settlement pending", async () => {
    const scope = new PreparedRequestScope("window-session");
    const release = vi.fn();
    const actor = {
      retain: vi.fn(() => ({
        ready: Promise.resolve(),
        refresh: vi.fn(async () => undefined),
        release,
      })),
      getView: vi.fn(() => ({
        state: {
          appId: 7,
          revision: 0,
          state: { type: "closed" },
          activeInvocationRef: null,
          lastSettlement: null,
        },
        connection: "disconnected",
        snapshot: { kind: "unavailable" },
      })),
      subscribe: vi.fn(() => () => undefined),
      subscribeOperationOutcome: vi.fn(() => () => undefined),
      dispatch: vi
        .fn()
        .mockRejectedValue(
          new RemoteMachineTransportError("disconnected", "connection lost"),
        ),
    };
    const requestActor = createVersionPreviewRequestActor(
      { actor: vi.fn(() => actor) } as never,
      scope,
      7,
    );
    const request = requestActor.request({
      intent: {
        type: "SELECT_VERSION",
        versionId: "abc123",
        operationId: "select",
      },
    });

    await expect(
      observeVersionPreviewAdmission(request, vi.fn()),
    ).resolves.toBeUndefined();
    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
    expect(actor.dispatch).toHaveBeenCalledTimes(2);
    expect(actor.dispatch.mock.calls[1]?.[1].requestIdentity).toEqual(
      actor.dispatch.mock.calls[0]?.[1].requestIdentity,
    );
    expect(release).toHaveBeenCalledTimes(2);
    expect(scope.inspectActiveCount()).toBe(0);
  });

  it("labels a matching protocol-v1 settlement from the original intent", async () => {
    const scope = new PreparedRequestScope("window-session");
    let listener: (() => void) | undefined;
    let lastSettlement: {
      operationId: string;
      outcome: "succeeded";
    } | null = null;
    const actor = {
      retain: vi.fn(() => ({
        ready: Promise.resolve(),
        refresh: vi.fn(async () => undefined),
        release: vi.fn(),
      })),
      getView: vi.fn(() => ({
        state: {
          appId: 7,
          revision: 0,
          state: { type: "closed" },
          activeInvocationRef: null,
          lastSettlement,
        },
        connection: "ready",
        snapshot: {
          kind: "available",
          observedRevision: {
            kind: "actor",
            actorInstanceId: "actor",
            revision: 0,
          },
        },
      })),
      subscribe: vi.fn((next: () => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
      subscribeOperationOutcome: vi.fn(() => () => undefined),
      dispatch: vi.fn(async (_intent, options) => {
        lastSettlement = {
          operationId: options.requestIdentity.requestId,
          outcome: "succeeded",
        };
        listener?.();
        return { kind: "applied" };
      }),
    };
    const requestActor = createVersionPreviewRequestActor(
      { actor: vi.fn(() => actor) } as never,
      scope,
      7,
    );

    const request = requestActor.request({
      intent: {
        type: "RESTORE_TO_MESSAGE",
        chatId: 2,
        messageId: 3,
        restoreCodebase: true,
        operationId: "restore-message",
      },
    });

    await expect(request.admission).resolves.toMatchObject({
      kind: "admitted",
    });
    await expect(request.settled).resolves.toEqual({
      kind: "completed",
      outcome: {
        kind: "succeeded",
        operation: "restore-to-message",
      },
    });
    expect(scope.inspectActiveCount()).toBe(0);
  });
});
