import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  ChevronDown,
  ChevronUp,
  ImageIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { imageGenerationJobsAtom } from "@/atoms/imageGenerationAtoms";
import type {
  ImageGenerationJob,
  ImageGenerationStatus,
} from "@/atoms/imageGenerationAtoms";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { useCancelImageGeneration } from "@/hooks/useGenerateImage";
import { ImageLightbox } from "@/components/chat/ImageLightbox";

const THEME_LABELS: Record<string, string> = {
  plain: "Plain",
  "3d-clay": "3D / Clay",
  "real-photography": "Photography",
  "isometric-illustration": "Isometric",
};

function StatusIcon({ status }: { status: ImageGenerationStatus }) {
  switch (status) {
    case "pending":
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    case "cancelled":
      return <Ban className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

function StatusLabel({ status }: { status: ImageGenerationStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="text-xs">
          Generating
        </Badge>
      );
    case "success":
      return (
        <Badge variant="secondary" className="text-xs text-green-600">
          Completed
        </Badge>
      );
    case "error":
      return (
        <Badge variant="secondary" className="text-xs text-red-600">
          Failed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="text-xs text-muted-foreground">
          Cancelled
        </Badge>
      );
  }
}

function useRelativeTime(timestamp: number, intervalMs = 30_000): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function RelativeTime({ timestamp }: { timestamp: number }) {
  const label = useRelativeTime(timestamp);
  return <span className="text-xs text-muted-foreground">{label}</span>;
}

function ImageGenerationCard({ job }: { job: ImageGenerationJob }) {
  const [expanded, setExpanded] = useState(false);
  const cancelGeneration = useCancelImageGeneration();
  const [imgError, setImgError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const truncatedPrompt =
    job.prompt.length > 60 ? job.prompt.slice(0, 60) + "…" : job.prompt;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Collapsed header - always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusIcon status={job.status} />
        <p className="text-sm flex-1 min-w-0 truncate">{truncatedPrompt}</p>
        <RelativeTime timestamp={job.startedAt} />
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Full prompt */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Prompt
            </p>
            <p className="text-sm whitespace-pre-wrap">{job.prompt}</p>
          </div>

          {/* Image preview or placeholder */}
          <div>
            {job.status === "pending" ? (
              <div className="w-full aspect-video max-w-xs rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center gap-2 bg-muted/10">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
                <p className="text-xs text-muted-foreground">Generating...</p>
              </div>
            ) : job.status === "success" && job.result ? (
              imgError ? (
                <div className="w-full max-w-xs aspect-video rounded-lg border bg-muted/10 flex items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer"
                  onClick={() => setLightboxOpen(true)}
                >
                  <img
                    src={buildDyadMediaUrl(
                      job.result.appPath,
                      job.result.fileName,
                    )}
                    alt="Generated image"
                    className="w-full max-w-xs rounded-lg border shadow-sm hover:opacity-90 transition-opacity"
                    onError={() => setImgError(true)}
                  />
                </button>
              )
            ) : job.status === "error" ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {job.error || "Image generation failed"}
              </div>
            ) : job.status === "cancelled" ? (
              <div className="w-full aspect-video max-w-xs rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center gap-2 bg-muted/10">
                <Ban className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Generation was cancelled
                </p>
              </div>
            ) : null}
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusLabel status={job.status} />
            <Badge variant="outline" className="text-xs">
              {THEME_LABELS[job.themeMode] || job.themeMode}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {job.targetAppName}
            </span>
          </div>

          {/* Cancel button for pending jobs */}
          {job.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => cancelGeneration(job.id)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {lightboxOpen &&
        job.status === "success" &&
        job.result &&
        createPortal(
          <ImageLightbox
            imageUrl={buildDyadMediaUrl(
              job.result.appPath,
              job.result.fileName,
            )}
            alt={job.prompt}
            onClose={() => setLightboxOpen(false)}
            onError={() => setImgError(true)}
          />,
          document.body,
        )}
    </div>
  );
}

export function ImageGenerationProgressDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const recentJobs = useAtomValue(imageGenerationJobsAtom);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Image Generation
          </DialogTitle>
          <DialogDescription>
            Recent image generations from the last 30 minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {recentJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No recent image generations.
            </div>
          ) : (
            recentJobs
              .slice()
              .sort((a, b) => b.startedAt - a.startedAt)
              .map((job) => <ImageGenerationCard key={job.id} job={job} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
