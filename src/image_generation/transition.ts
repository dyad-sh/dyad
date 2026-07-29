import { ignore } from "@/state_machines/types";
import {
  IMAGE_GENERATION_INVOCATION_KIND,
  type ImageGenerationActorJob,
  type ImageGenerationActorState,
  type ImageGenerationCommand,
  type ImageGenerationCorrelatedOutcome,
  type ImageGenerationEvent,
  type ImageGenerationInvocationRef,
  type ImageGenerationJob,
  type ImageGenerationTransitionResult,
} from "./state";

export function transition(
  state: ImageGenerationActorState,
  event: ImageGenerationEvent,
): ImageGenerationTransitionResult {
  if (event.type === "SUBMIT") {
    const existing = state.jobs.find(({ job }) => job.id === event.job.id);
    if (existing) {
      return ignore(
        state,
        sameJob(existing.job, event.job) ? "duplicate-job" : "job-id-conflict",
      );
    }
    if (
      state.jobs.some(
        ({ activeInvocationRef }) =>
          activeInvocationRef?.operationId === event.operationId,
      )
    ) {
      return ignore(state, "operation-id-conflict");
    }
    const activeInvocationRef = invocation(event.job.id, event.operationId);
    return {
      kind: "applied",
      state: {
        jobs: [
          ...state.jobs,
          {
            job: { ...event.job, status: "pending" },
            requestId: event.requestId,
            activeInvocationRef,
          },
        ],
      },
      commands: [
        ...(event.initiatorWindowSessionId
          ? [
              {
                type: "RecordInitiator" as const,
                jobId: event.job.id,
                windowSessionId: event.initiatorWindowSessionId,
              },
            ]
          : []),
        {
          type: "GenerateImage",
          jobId: event.job.id,
          invocationRef: activeInvocationRef,
          params: {
            prompt: event.job.prompt,
            themeMode: event.job.themeMode,
            targetAppId: event.job.targetAppId,
            targetAppName: event.job.targetAppName,
            source: event.job.source,
          },
        },
        { type: "Present", jobId: event.job.id },
      ],
    };
  }

  if (event.type === "APP_DELETED") {
    const removed = state.jobs.filter(
      ({ job }) => job.targetAppId === event.appId,
    );
    if (removed.length === 0) return ignore(state, "job-not-found");
    return {
      kind: "applied",
      state: {
        jobs: state.jobs.filter(({ job }) => job.targetAppId !== event.appId),
      },
      commands: removed.flatMap(({ job, activeInvocationRef }) =>
        activeInvocationRef &&
        (job.status === "pending" || job.status === "cancelling")
          ? [
              {
                type: "RequestCancel" as const,
                jobId: job.id,
                invocationRef: activeInvocationRef,
              },
            ]
          : [],
      ),
      outcomes: removed.flatMap(({ job, requestId, activeInvocationRef }) =>
        activeInvocationRef
          ? [
              {
                requestId,
                invocationRef: activeInvocationRef,
                outcome: {
                  kind: "disposed" as const,
                  jobId: job.id,
                  cause: "app-deletion" as const,
                },
              },
            ]
          : [],
      ),
    };
  }

  if (event.type === "PRUNE_JOB") {
    const existing = state.jobs.find(({ job }) => job.id === event.jobId);
    if (!existing) return ignore(state, "job-not-found");
    if (!isTerminal(existing.job)) return ignore(state, "stale-operation");
    return {
      kind: "applied",
      state: {
        jobs: state.jobs.filter(({ job }) => job.id !== event.jobId),
      },
      commands: [],
    };
  }

  const index = state.jobs.findIndex(({ job }) => job.id === event.jobId);
  if (index === -1) return ignore(state, "job-not-found");
  const current = state.jobs[index];

  if (
    event.type !== "CANCEL_REQUESTED" &&
    !sameInvocation(current.activeInvocationRef, event.invocationRef)
  ) {
    return ignore(state, "stale-operation");
  }
  if (
    event.type === "CANCEL_REQUESTED" &&
    !sameInvocation(current.activeInvocationRef, event.activeInvocationRef)
  ) {
    return ignore(state, "stale-operation");
  }

  switch (event.type) {
    case "CANCEL_REQUESTED":
      if (current.job.status === "cancelling") {
        return ignore(state, "already-cancelling");
      }
      if (isTerminal(current.job)) return ignore(state, "already-terminal");
      return replace(
        state,
        index,
        {
          job: { ...current.job, status: "cancelling" },
          requestId: current.requestId,
          activeInvocationRef: current.activeInvocationRef,
        },
        [
          {
            type: "RequestCancel",
            jobId: current.job.id,
            invocationRef: event.activeInvocationRef,
          },
          { type: "Present", jobId: current.job.id },
        ],
      );

    case "JOB_SUCCEEDED": {
      if (isTerminal(current.job)) return ignore(state, "already-terminal");
      const lateAfterCancel = current.job.status === "cancelling";
      const nextJob: ImageGenerationActorJob = {
        job: {
          ...current.job,
          status: "success",
          result: event.result,
          lateAfterCancel,
        },
        requestId: current.requestId,
        activeInvocationRef: null,
      };
      const { fileName, appId, appName } = event.result;
      return replace(
        state,
        index,
        nextJob,
        [
          { type: "InvalidateMediaQueries" },
          { type: "SchedulePrune", jobId: current.job.id },
          { type: "Present", jobId: current.job.id },
        ],
        [
          {
            requestId: current.requestId,
            invocationRef: event.invocationRef,
            outcome: {
              kind: "succeeded",
              jobId: current.job.id,
              result: { fileName, appId, appName },
            },
          },
        ],
      );
    }

    case "JOB_FAILED": {
      if (isTerminal(current.job)) return ignore(state, "already-terminal");
      const cancelled =
        current.job.status === "cancelling" && event.kind === "user_cancelled";
      const nextJob: ImageGenerationActorJob = {
        job: cancelled
          ? { ...current.job, status: "cancelled" }
          : {
              ...current.job,
              status: "error",
              error: event.message,
            },
        requestId: current.requestId,
        activeInvocationRef: null,
      };
      return replace(
        state,
        index,
        nextJob,
        [
          { type: "SchedulePrune", jobId: current.job.id },
          { type: "Present", jobId: current.job.id },
        ],
        [
          {
            requestId: current.requestId,
            invocationRef: event.invocationRef,
            outcome: cancelled
              ? { kind: "cancelled", jobId: current.job.id }
              : {
                  kind: "failed",
                  jobId: current.job.id,
                  message: event.message,
                  failureKind:
                    event.kind === "unexpected" ? "unexpected" : "provider",
                },
          },
        ],
      );
    }

    case "CANCEL_CONFIRMED":
      if (isTerminal(current.job)) return ignore(state, "already-terminal");
      // Best-effort acknowledgement only. The generation promise remains the
      // terminal authority whether cancellation was observed or raced settle.
      return { kind: "applied", state, commands: [] };

    default:
      return assertNever(event);
  }
}

function replace(
  state: ImageGenerationActorState,
  index: number,
  job: ImageGenerationActorJob,
  commands: readonly ImageGenerationCommand[],
  outcomes: readonly ImageGenerationCorrelatedOutcome[] = [],
): ImageGenerationTransitionResult {
  return {
    kind: "applied",
    state: {
      jobs: replaceJob(state.jobs, index, job),
    },
    commands,
    ...(outcomes.length > 0 ? { outcomes } : {}),
  };
}

function replaceJob(
  jobs: readonly ImageGenerationActorJob[],
  index: number,
  job: ImageGenerationActorJob,
): readonly ImageGenerationActorJob[] {
  return jobs.map((current, currentIndex) =>
    currentIndex === index ? job : current,
  );
}

function sameJob(
  left: ImageGenerationJob,
  right: Omit<ImageGenerationJob, "status">,
): boolean {
  return (
    left.id === right.id &&
    left.startedAt === right.startedAt &&
    left.prompt === right.prompt &&
    left.themeMode === right.themeMode &&
    left.targetAppId === right.targetAppId &&
    left.targetAppName === right.targetAppName &&
    left.source === right.source
  );
}

export function isTerminal(job: ImageGenerationJob): boolean {
  return (
    job.status === "success" ||
    job.status === "error" ||
    job.status === "cancelled"
  );
}

function invocation(
  jobId: string,
  operationId: string,
): ImageGenerationInvocationRef {
  return {
    kind: IMAGE_GENERATION_INVOCATION_KIND,
    entityKey: jobId,
    operationId,
  };
}

function sameInvocation(
  left: ImageGenerationInvocationRef | null,
  right: ImageGenerationInvocationRef,
): boolean {
  return (
    left?.kind === right.kind &&
    left.entityKey === right.entityKey &&
    left.operationId === right.operationId
  );
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected image-generation event: ${JSON.stringify(value)}`,
  );
}
