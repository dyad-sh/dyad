import { useEffect, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { X, Loader2, Plus, AlertCircle, RotateCcw } from "lucide-react";
import {
  chatImageGenerationJobsAtom,
  dismissedImageGenerationJobIdsAtom,
} from "@/atoms/imageGenerationAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  useCancelImageGeneration,
  useGenerateImage,
} from "@/hooks/useGenerateImage";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { ImageLightbox } from "./ImageLightbox";
import type { ImageGenerationJob } from "@/atoms/imageGenerationAtoms";

interface ChatImageGenerationStripProps {
  onGenerateImage: () => void;
}

export function ChatImageGenerationStrip({
  onGenerateImage,
}: ChatImageGenerationStripProps) {
  const jobs = useAtomValue(chatImageGenerationJobsAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const cancelImageGeneration = useCancelImageGeneration();
  const generateImage = useGenerateImage();
  const [dismissedJobIds, setDismissedJobIds] = useAtom(
    dismissedImageGenerationJobIdsAtom,
  );
  const [lightboxJob, setLightboxJob] = useState<ImageGenerationJob | null>(
    null,
  );

  // Prune stale dismissed IDs that no longer correspond to active jobs
  useEffect(() => {
    const validJobIds = new Set(jobs.map((j) => j.id));
    if ([...dismissedJobIds].some((id) => !validJobIds.has(id))) {
      setDismissedJobIds(
        new Set([...dismissedJobIds].filter((id) => validJobIds.has(id))),
      );
    }
  }, [jobs, dismissedJobIds, setDismissedJobIds]);

  // Only show jobs for the currently selected app
  const appJobs = selectedAppId
    ? jobs.filter((job) => job.targetAppId === selectedAppId)
    : jobs;

  const visibleJobs = appJobs.filter(
    (job) =>
      !dismissedJobIds.has(job.id) &&
      (job.status === "pending" ||
        job.status === "success" ||
        job.status === "error"),
  );

  if (visibleJobs.length === 0) return null;

  const handleDismiss = (jobId: string) => {
    setDismissedJobIds((prev: Set<string>) => new Set(prev).add(jobId));
  };

  const handleRetry = (job: ImageGenerationJob) => {
    setDismissedJobIds((prev: Set<string>) => new Set(prev).add(job.id));
    generateImage.mutate({
      requestId: crypto.randomUUID(),
      prompt: job.prompt,
      themeMode: job.themeMode,
      targetAppId: job.targetAppId,
      targetAppName: job.targetAppName,
      source: job.source,
    });
  };

  const handleCancel = (jobId: string) => {
    void cancelImageGeneration(jobId);
    setDismissedJobIds((prev: Set<string>) => new Set(prev).add(jobId));
  };

  return (
    <>
      <div className="px-2 pt-2 flex flex-wrap items-center gap-2">
        {visibleJobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center bg-muted rounded-lg px-2 py-1.5 text-xs gap-2"
          >
            {job.status === "pending" ? (
              <>
                <div className="w-12 h-12 rounded-md bg-muted-foreground/10 animate-pulse flex items-center justify-center shrink-0">
                  <Loader2
                    size={16}
                    className="animate-spin text-muted-foreground"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-muted-foreground truncate block max-w-[120px]">
                    {job.prompt}
                  </span>
                  <span className="text-muted-foreground/60 text-[10px]">
                    Generating...
                  </span>
                </div>
                <button
                  onClick={() => handleCancel(job.id)}
                  className="hover:bg-muted-foreground/20 rounded-full p-1.5 shrink-0"
                  aria-label="Cancel generation"
                >
                  <X size={12} />
                </button>
              </>
            ) : job.status === "error" ? (
              <>
                <div className="w-12 h-12 rounded-md bg-destructive/15 flex items-center justify-center shrink-0">
                  <AlertCircle
                    size={16}
                    className="text-destructive-foreground"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <span
                    className="text-destructive-foreground truncate block max-w-[120px]"
                    title={job.error ?? "Generation failed"}
                  >
                    {job.error ?? "Generation failed"}
                  </span>
                </div>
                <button
                  onClick={() => handleRetry(job)}
                  className="hover:bg-muted-foreground/20 rounded-full p-1.5 shrink-0"
                  aria-label="Retry generation"
                  title="Retry"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  onClick={() => handleDismiss(job.id)}
                  className="hover:bg-muted-foreground/20 rounded-full p-1.5 shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                {job.result && (
                  <img
                    src={buildDyadMediaUrl(
                      job.result.appPath,
                      job.result.fileName,
                    )}
                    alt={job.prompt}
                    className="w-12 h-12 rounded-md object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setLightboxJob(job)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="truncate block max-w-[120px]">
                    {job.result?.fileName ?? "Generated image"}
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(job.id)}
                  className="hover:bg-muted-foreground/20 rounded-full p-1.5 shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        ))}
        <button
          onClick={onGenerateImage}
          className="group flex items-center justify-center w-12 h-12 shrink-0 cursor-pointer"
          aria-label="Generate another image"
          title="Generate another image"
        >
          <Plus
            size={18}
            className="text-muted-foreground group-hover:text-foreground transition-colors"
          />
        </button>
      </div>

      {lightboxJob?.result && (
        <ImageLightbox
          imageUrl={buildDyadMediaUrl(
            lightboxJob.result.appPath,
            lightboxJob.result.fileName,
          )}
          alt={lightboxJob.prompt}
          filePath={lightboxJob.result.filePath}
          onClose={() => setLightboxJob(null)}
        />
      )}
    </>
  );
}
