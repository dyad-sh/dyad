import { describe, expect, it } from "vitest";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
  ImageGenerationInvocationRef,
  ImageGenerationJobDetails,
} from "./state";
import { transition } from "./transition";
import type { RequestId } from "@/distributed_machines/request_identity";

const job: ImageGenerationJobDetails = {
  id: "job-1",
  prompt: "A lighthouse",
  themeMode: "plain",
  targetAppId: 1,
  targetAppName: "App",
  source: "chat",
  startedAt: 10,
};
const invocationRef: ImageGenerationInvocationRef = {
  kind: "image-generation",
  entityKey: job.id,
  operationId: "operation-1",
};
const requestId = "request-1" as RequestId;
const result = {
  fileName: "generated.png",
  filePath: "/tmp/generated.png",
  appPath: "app",
  appId: 1,
  appName: "App",
};

function submittedState(): ImageGenerationActorState {
  const outcome = transition(
    { jobs: [] },
    { type: "SUBMIT", job, requestId, operationId: invocationRef.operationId },
  );
  if (outcome.kind !== "applied") throw new Error("submit was ignored");
  return outcome.state;
}

describe("image generation transition", () => {
  it("creates a pending job and starts provider work exactly once", () => {
    const initial: ImageGenerationActorState = { jobs: [] };
    const first = transition(initial, {
      type: "SUBMIT",
      job,
      requestId,
      operationId: invocationRef.operationId,
    });
    expect(first).toMatchObject({
      kind: "applied",
      state: {
        jobs: [
          {
            job: { id: job.id, status: "pending" },
            activeInvocationRef: invocationRef,
          },
        ],
      },
      commands: [
        { type: "GenerateImage", jobId: job.id, invocationRef },
        { type: "Present", jobId: job.id },
      ],
    });
    if (first.kind !== "applied") throw new Error("submit was ignored");

    expect(
      transition(first.state, {
        type: "SUBMIT",
        job,
        requestId: "request-2" as RequestId,
        operationId: "retry-operation",
      }),
    ).toMatchObject({ kind: "ignored", reason: "duplicate-job" });
    expect(
      transition(first.state, {
        type: "SUBMIT",
        job: { ...job, prompt: "Different payload" },
        requestId: "request-3" as RequestId,
        operationId: "conflicting-operation",
      }),
    ).toMatchObject({ kind: "ignored", reason: "job-id-conflict" });
    expect(
      transition(first.state, {
        type: "SUBMIT",
        job: { ...job, id: "job-2" },
        requestId: "request-4" as RequestId,
        operationId: invocationRef.operationId,
      }),
    ).toMatchObject({ kind: "ignored", reason: "operation-id-conflict" });
  });

  it("records the host-authorized initiator only for an applied submission", () => {
    const first = transition(
      { jobs: [] },
      {
        type: "SUBMIT",
        job,
        requestId,
        operationId: invocationRef.operationId,
        initiatorWindowSessionId: "window-a",
      },
    );
    expect(first.kind).toBe("applied");
    if (first.kind !== "applied") throw new Error("submit was ignored");
    expect(first.commands[0]).toEqual({
      type: "RecordInitiator",
      jobId: job.id,
      windowSessionId: "window-a",
    });
    expect(
      transition(first.state, {
        type: "SUBMIT",
        job,
        requestId: "request-2" as RequestId,
        operationId: "duplicate-operation",
        initiatorWindowSessionId: "window-b",
      }),
    ).toMatchObject({ kind: "ignored", reason: "duplicate-job" });
  });

  it("keeps the generation settlement as terminal authority after cancel", () => {
    const cancelling = transition(submittedState(), {
      type: "CANCEL_REQUESTED",
      jobId: job.id,
      activeInvocationRef: invocationRef,
    });
    expect(cancelling).toMatchObject({
      kind: "applied",
      state: { jobs: [{ job: { status: "cancelling" } }] },
    });
    if (cancelling.kind !== "applied") throw new Error("cancel was ignored");

    const acknowledgement = transition(cancelling.state, {
      type: "CANCEL_CONFIRMED",
      jobId: job.id,
      invocationRef,
      cancelled: true,
    });
    expect(acknowledgement).toEqual({
      kind: "applied",
      state: cancelling.state,
      commands: [],
    });

    const lateSuccess = transition(cancelling.state, {
      type: "JOB_SUCCEEDED",
      jobId: job.id,
      invocationRef,
      result,
    });
    expect(lateSuccess).toMatchObject({
      kind: "applied",
      state: {
        jobs: [
          {
            job: { status: "success", lateAfterCancel: true, result },
            activeInvocationRef: null,
          },
        ],
      },
      commands: [
        { type: "InvalidateMediaQueries" },
        { type: "SchedulePrune", jobId: job.id },
        { type: "Present", jobId: job.id },
      ],
    });
  });

  it("rejects stale settlements by invocation identity", () => {
    const event: ImageGenerationEvent = {
      type: "JOB_SUCCEEDED",
      jobId: job.id,
      invocationRef: { ...invocationRef, operationId: "stale" },
      result,
    };
    expect(transition(submittedState(), event)).toMatchObject({
      kind: "ignored",
      reason: "stale-operation",
    });
  });

  it("cancels active work and prunes every job for a deleted app", () => {
    const outcome = transition(submittedState(), {
      type: "APP_DELETED",
      appId: 1,
    });
    expect(outcome).toEqual({
      kind: "applied",
      state: { jobs: [] },
      commands: [
        {
          type: "RequestCancel",
          jobId: job.id,
          invocationRef,
        },
      ],
      outcomes: [
        {
          requestId,
          invocationRef,
          outcome: {
            kind: "disposed",
            jobId: job.id,
            cause: "app-deletion",
          },
        },
      ],
    });
  });
});
