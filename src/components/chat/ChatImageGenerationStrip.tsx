import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X, Plus, Loader2 } from "lucide-react";
import { chatImageGenerationJobsAtom } from "@/atoms/imageGenerationAtoms";
import { chatInputValueAtom } from "@/atoms/chatAtoms";
import { useCancelImageGeneration } from "@/hooks/useGenerateImage";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { ImageLightbox } from "./ImageLightbox";
import type { ImageGenerationJob } from "@/atoms/imageGenerationAtoms";

export function ChatImageGenerationStrip() {
  const jobs = useAtomValue(chatImageGenerationJobsAtom);
  const setChatInput = useSetAtom(chatInputValueAtom);
  const cancelImageGeneration = useCancelImageGeneration();
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(
    new Set(),
  );
  const [lightboxJob, setLightboxJob] = useState<ImageGenerationJob | null>(
    null,
  );

  const visibleJobs = jobs.filter(
    (job) =>
      !dismissedJobIds.has(job.id) &&
      (job.status === "pending" || job.status === "success"),
  );

  if (visibleJobs.length === 0) return null;

  const handleAddToChat = (job: ImageGenerationJob) => {
    if (!job.result) return;
    const encodedFileName = encodeURIComponent(job.result.fileName);
    const mention = `@media:${encodedFileName}`;
    setChatInput((prev: string) =>
      prev.trim() ? `${prev} ${mention} ` : `${mention} `,
    );
    setDismissedJobIds((prev) => new Set(prev).add(job.id));
  };

  const handleDismiss = (jobId: string) => {
    setDismissedJobIds((prev) => new Set(prev).add(jobId));
  };

  const handleCancel = (jobId: string) => {
    cancelImageGeneration(jobId);
    setDismissedJobIds((prev) => new Set(prev).add(jobId));
  };

  return (
    <>
      <div className="px-2 pt-2 flex flex-wrap gap-2">
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
                    {job.prompt.length > 30
                      ? `${job.prompt.slice(0, 30)}...`
                      : job.prompt}
                  </span>
                  <span className="text-muted-foreground/60 text-[10px]">
                    Generating...
                  </span>
                </div>
                <button
                  onClick={() => handleCancel(job.id)}
                  className="hover:bg-muted-foreground/20 rounded-full p-0.5 shrink-0"
                  aria-label="Cancel generation"
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
                  onClick={() => handleAddToChat(job)}
                  className="flex items-center gap-0.5 text-primary hover:text-primary/80 transition-colors shrink-0 cursor-pointer"
                  aria-label="Add to chat"
                >
                  <Plus size={12} />
                  <span>Add to chat</span>
                </button>
                <button
                  onClick={() => handleDismiss(job.id)}
                  className="hover:bg-muted-foreground/20 rounded-full p-0.5 shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        ))}
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
