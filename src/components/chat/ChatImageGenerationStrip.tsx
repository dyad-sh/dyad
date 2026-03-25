import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { X, ArrowUpRight, Loader2, Plus, AlertCircle } from "lucide-react";
import {
  chatImageGenerationJobsAtom,
  dismissedImageGenerationJobIdsAtom,
} from "@/atoms/imageGenerationAtoms";
import { chatInputValueAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useCancelImageGeneration } from "@/hooks/useGenerateImage";
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
  const setChatInput = useSetAtom(chatInputValueAtom);
  const cancelImageGeneration = useCancelImageGeneration();
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

  const handleAddToChat = (job: ImageGenerationJob) => {
    if (!job.result) return;
    const encodedFileName = encodeURIComponent(job.result.fileName);
    const mention = `@media:${encodedFileName}`;
    setChatInput((prev: string) =>
      prev.trim() ? `${prev} ${mention} ` : `${mention} `,
    );
    setDismissedJobIds((prev: Set<string>) => new Set(prev).add(job.id));
  };

  const handleDismiss = (jobId: string) => {
    setDismissedJobIds((prev: Set<string>) => new Set(prev).add(jobId));
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
                <div className="w-12 h-12 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertCircle size={16} className="text-destructive" />
                </div>
                <div className="min-w-0 flex-1">
                  <span
                    className="text-destructive truncate block max-w-[120px]"
                    title={job.error ?? "Generation failed"}
                  >
                    {job.error ?? "Generation failed"}
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
                {job.result && (
                  <button
                    onClick={() => handleAddToChat(job)}
                    className="flex items-center gap-0.5 text-primary hover:text-primary/80 transition-colors shrink-0 cursor-pointer"
                    aria-label="Add to chat"
                  >
                    <span>Add to chat</span>
                    <ArrowUpRight size={12} />
                  </button>
                )}
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
