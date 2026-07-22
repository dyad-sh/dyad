import { KeyedControllerHost } from "@/state_machines/keyed_host";
import type { Clock, IdSource } from "@/state_machines/clock";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { createTraceObserver } from "@/state_machines/trace";
import type { TransitionObserver } from "@/state_machines/types";
import type { ImageGenerationJob } from "@/atoms/imageGenerationAtoms";
import {
  ImageGenerationController,
  type ImageGenerationCommandRunner,
} from "./controller";
import type {
  ImageGenerationCommand,
  ImageGenerationEvent,
  ImageGenerationJobDetails,
  ImageGenerationState,
  StartImageGenerationParams,
} from "./state";

const TERMINAL_RETENTION_MS = 30 * 60 * 1000;
const EMPTY_JOBS: ImageGenerationJob[] = [];

export interface ImageGenerationManagerOptions {
  clock: Clock;
  idSource: IdSource;
  runner: ImageGenerationCommandRunner;
  observer?: (
    jobId: string,
  ) => TransitionObserver<
    ImageGenerationState,
    ImageGenerationEvent,
    ImageGenerationCommand
  >;
}

/** Provider-owned facade for concurrent image-generation job controllers. */
export class ImageGenerationManager {
  private readonly host: KeyedControllerHost<string, ImageGenerationController>;
  private readonly pendingCreations = new Map<
    string,
    ImageGenerationJobDetails
  >();
  private readonly projectionStore = new SnapshotStore<ImageGenerationJob[]>(
    EMPTY_JOBS,
  );
  private readonly unsubscribeHost: () => void;
  private disposed = false;

  constructor(private readonly options: ImageGenerationManagerOptions) {
    this.host = new KeyedControllerHost((jobId) => {
      const job = this.pendingCreations.get(jobId);
      if (!job) {
        throw new Error(`Missing image-generation job details for ${jobId}`);
      }
      return new ImageGenerationController(
        options.runner,
        job,
        options.observer?.(jobId) ??
          createTraceObserver("image_generation", jobId),
      );
    });
    this.unsubscribeHost = this.host.subscribeAny(this.refreshProjection);
  }

  getProjection = this.projectionStore.getSnapshot;

  subscribeProjection = this.projectionStore.subscribe;

  submit(params: StartImageGenerationParams): string {
    if (this.disposed) {
      throw new Error(
        "Cannot start a job on a disposed image-generation manager",
      );
    }
    this.pruneTerminalJobs();
    const id = this.options.idSource.next("image-generation");
    const job: ImageGenerationJobDetails = {
      ...params,
      id,
      startedAt: this.options.clock.now(),
    };
    this.pendingCreations.set(id, job);
    try {
      const controller = this.host.ensure(id);
      this.refreshProjection();
      controller.start();
    } finally {
      this.pendingCreations.delete(id);
    }
    return id;
  }

  cancel(jobId: string): void {
    this.host.get(jobId)?.send({ type: "CANCEL_REQUESTED" });
  }

  getState(jobId: string): ImageGenerationState | undefined {
    return this.host.get(jobId)?.getSnapshot();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeHost();
    this.host.dispose();
    this.pendingCreations.clear();
    this.projectionStore.dispose();
  }

  private readonly refreshProjection = (): void => {
    const next = this.host.keys().flatMap((jobId) => {
      const state = this.host.get(jobId)?.getSnapshot();
      return state ? [projectImageGenerationState(state)] : [];
    });
    this.projectionStore.setState(next.length === 0 ? EMPTY_JOBS : next);
  };

  private pruneTerminalJobs(): void {
    const cutoff = this.options.clock.now() - TERMINAL_RETENTION_MS;
    for (const jobId of this.host.keys()) {
      const state = this.host.get(jobId)?.getSnapshot();
      if (state && isTerminal(state) && state.job.startedAt <= cutoff) {
        this.host.disposeKey(jobId);
      }
    }
  }
}

function isTerminal(state: ImageGenerationState): boolean {
  return (
    state.type === "succeeded" ||
    state.type === "failed" ||
    state.type === "cancelled"
  );
}

export function projectImageGenerationState(
  state: ImageGenerationState,
): ImageGenerationJob {
  const base = state.job;
  switch (state.type) {
    case "pending":
      return { ...base, status: "pending" };
    case "cancelling":
      return { ...base, status: "cancelling" };
    case "succeeded":
      return {
        ...base,
        status: "success",
        result: state.result,
        lateAfterCancel: state.lateAfterCancel,
      };
    case "failed":
      return { ...base, status: "error", error: state.message };
    case "cancelled":
      return { ...base, status: "cancelled" };
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected image-generation state: ${JSON.stringify(value)}`,
  );
}
