import type {
  ImageGenerationActorState,
  ImageGenerationJob,
} from "@/image_generation/state";
import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";

const PRESENTATION_CHANNEL = "image-generation:presentation";

export class ImageGenerationPresentationService {
  private readonly initiatorByJobId = new Map<string, WindowSessionId>();

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(jobId: string, windowSessionId: string | undefined): void {
    if (!windowSessionId) return;
    if (this.initiatorByJobId.size >= 512) {
      const oldest = this.initiatorByJobId.keys().next().value;
      if (oldest) this.initiatorByJobId.delete(oldest);
    }
    this.initiatorByJobId.set(jobId, windowSessionId as WindowSessionId);
  }

  present(state: ImageGenerationActorState, jobId: string): void {
    const entry = state.jobs.find(({ job }) => job.id === jobId);
    if (!entry) return;
    const initiator = this.initiatorByJobId.get(jobId);
    const target = this.windows.routePresentation({
      effect: "operation-toast",
      ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
      entity: { kind: "app", id: entry.job.targetAppId },
    });
    if (target) {
      const pendingCount = state.jobs.filter(
        ({ job }) =>
          job.status === "pending" && this.routeForJob(job) === target,
      ).length;
      const payload = presentationPayload(entry.job, pendingCount);
      this.windows
        .endpointForSession(target)
        ?.send(PRESENTATION_CHANNEL, payload);
    }
    if (isTerminal(entry.job)) this.initiatorByJobId.delete(jobId);
  }

  forgetApp(appId: number, state: ImageGenerationActorState): void {
    for (const { job } of state.jobs) {
      if (job.targetAppId === appId) {
        this.initiatorByJobId.delete(job.id);
      }
    }
  }

  clear(): void {
    this.initiatorByJobId.clear();
  }

  private routeForJob(job: ImageGenerationJob): WindowSessionId | null {
    const initiator = this.initiatorByJobId.get(job.id);
    return this.windows.routePresentation({
      effect: "operation-toast",
      ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
      entity: { kind: "app", id: job.targetAppId },
    });
  }
}

function presentationPayload(job: ImageGenerationJob, pendingCount: number) {
  if (job.status === "success" && job.result && !job.lateAfterCancel) {
    const { fileName, appPath, appId, appName } = job.result;
    return {
      type: "succeeded" as const,
      result: { fileName, appPath, appId, appName },
      pendingCount,
    };
  }
  if (job.status === "error") {
    return {
      type: "failed" as const,
      message: job.error ?? "Image generation failed",
      pendingCount,
    };
  }
  return { type: "progress" as const, pendingCount };
}

function isTerminal(job: ImageGenerationJob): boolean {
  return (
    job.status === "success" ||
    job.status === "error" ||
    job.status === "cancelled"
  );
}

export const imageGenerationPresentationService =
  new ImageGenerationPresentationService();
