import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom, useStore } from "jotai";
import { ipc } from "@/ipc/types";
import type { ImageThemeMode } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  imageGenerationJobsAtom,
  type ImageGenerationJob,
} from "@/atoms/imageGenerationAtoms";
import {
  showImageGeneratingToast,
  showImageSuccessToast,
  dismissImageGenerationToast,
} from "@/components/ImageGenerationToast";

interface StartGenerationParams {
  requestId: string;
  prompt: string;
  themeMode: ImageThemeMode;
  targetAppId: number;
  targetAppName: string;
  source?: "chat" | "media-library";
}

// Track cancelled job IDs so onError can skip them when the abort error arrives.
// Each entry is auto-cleaned after CANCEL_CLEANUP_MS to prevent unbounded growth.
const cancelledJobIds = new Set<string>();
const CANCEL_CLEANUP_MS = 2 * 60 * 1000; // 2 minutes

function markCancelled(jobId: string) {
  cancelledJobIds.add(jobId);
  setTimeout(() => cancelledJobIds.delete(jobId), CANCEL_CLEANUP_MS);
}

export function useGenerateImage() {
  const queryClient = useQueryClient();
  const setJobs = useSetAtom(imageGenerationJobsAtom);
  const store = useStore();

  const addJob = (job: ImageGenerationJob) => {
    setJobs((prev) => [...prev, job]);
  };

  const updateJob = (id: string, patch: Partial<ImageGenerationJob>) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    );
  };

  const getPendingCount = () =>
    store.get(imageGenerationJobsAtom).filter((j) => j.status === "pending")
      .length;

  return useMutation({
    mutationFn: (params: StartGenerationParams) => {
      return ipc.imageGeneration.generateImage({
        prompt: params.prompt,
        themeMode: params.themeMode,
        targetAppId: params.targetAppId,
        requestId: params.requestId,
      });
    },
    onMutate: (params) => {
      addJob({
        id: params.requestId,
        prompt: params.prompt,
        themeMode: params.themeMode,
        targetAppId: params.targetAppId,
        targetAppName: params.targetAppName,
        status: "pending",
        startedAt: Date.now(),
        source: params.source,
      });

      // Show / update the single generating toast with the new pending count
      showImageGeneratingToast(getPendingCount());

      return { jobId: params.requestId };
    },
    onSuccess: (result, _params, context) => {
      if (!context) return;
      // If this job was already cancelled before the response arrived, ignore the success
      if (cancelledJobIds.has(context.jobId)) {
        cancelledJobIds.delete(context.jobId);
        return;
      }
      updateJob(context.jobId, {
        status: "success",
        result,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });

      // Show success toast (replaces the shared generating toast).
      // If there are still pending jobs, the toast's dismiss/close will
      // restore the generating toast via restoreGeneratingToastIfNeeded.
      showImageSuccessToast(result);
    },
    onError: (error, _params, context) => {
      if (!context) return;
      // If this job was cancelled, the abort error is expected — don't show it
      if (cancelledJobIds.has(context.jobId)) {
        cancelledJobIds.delete(context.jobId);
        return;
      }
      updateJob(context.jobId, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });

      const remaining = getPendingCount();
      if (remaining > 0) {
        // Other jobs still running — update count
        showImageGeneratingToast(remaining);
      } else {
        dismissImageGenerationToast();
      }
      showError(error);
    },
  });
}

export function useCancelImageGeneration() {
  const setJobs = useSetAtom(imageGenerationJobsAtom);
  const store = useStore();

  return async (jobId: string) => {
    markCancelled(jobId);
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId ? { ...job, status: "cancelled" as const } : job,
      ),
    );

    // Update or dismiss the generating toast based on remaining pending jobs
    const remaining = store
      .get(imageGenerationJobsAtom)
      .filter((j) => j.status === "pending").length;
    if (remaining > 0) {
      showImageGeneratingToast(remaining);
    } else {
      dismissImageGenerationToast();
    }

    // Signal the backend to abort the request
    try {
      await ipc.imageGeneration.cancelImageGeneration({ requestId: jobId });
    } catch {
      // Best-effort cancellation
    }
  };
}
