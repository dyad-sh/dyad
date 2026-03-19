import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import type { GenerateImageResponse } from "@/ipc/types";
import { getDefaultStore } from "jotai";
import { imageGenerationJobsAtom } from "@/atoms/imageGenerationAtoms";

const GENERATING_TOAST_ID = "image-gen-progress";
const SUCCESS_TOAST_ID = "image-gen-success";
const SUCCESS_AUTO_DISMISS_MS = 10_000;

function restoreGeneratingToastIfNeeded() {
  const store = getDefaultStore();
  const pending = store
    .get(imageGenerationJobsAtom)
    .filter((j) => j.status === "pending").length;
  if (pending > 0) {
    showImageGeneratingToast(pending);
  }
}

function DismissButton({
  toastId,
  onDismiss,
}: {
  toastId: string | number;
  onDismiss?: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toast.dismiss(toastId);
        onDismiss?.();
      }}
      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-muted border border-border shadow-sm flex items-center justify-center hover:bg-accent transition-colors z-10"
    >
      <X className="w-3 h-3 text-muted-foreground" />
    </button>
  );
}

export function ImageGeneratingToast({
  pendingCount,
  toastId,
}: {
  pendingCount: number;
  toastId: string | number;
}) {
  return (
    <div className="relative overflow-visible bg-background border border-border rounded-xl shadow-lg min-w-[340px] max-w-[420px] p-3">
      <DismissButton toastId={toastId} />
      <div className="flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {pendingCount > 1
              ? `Generating ${pendingCount} images…`
              : "Generating image…"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ImageSuccessToast({
  result,
  toastId,
}: {
  result: GenerateImageResponse;
  toastId: string | number;
}) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const imageUrl = buildDyadMediaUrl(result.appPath, result.fileName);

  return (
    <>
      <div className="relative overflow-visible bg-background border border-border rounded-xl shadow-lg min-w-[340px] max-w-[420px] p-3">
        <DismissButton
          toastId={toastId}
          onDismiss={restoreGeneratingToastIfNeeded}
        />
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Image ready</p>
            <p className="text-xs text-muted-foreground truncate">
              Saved to {result.appName}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(true);
            }}
          >
            Open image
          </Button>
        </div>
      </div>
      {isLightboxOpen &&
        createPortal(
          <ImageLightbox
            imageUrl={imageUrl}
            alt="Generated image"
            filePath={result.filePath}
            onClose={() => {
              setIsLightboxOpen(false);
              toast.dismiss(toastId);
              restoreGeneratingToastIfNeeded();
            }}
          />,
          document.body,
        )}
    </>
  );
}

export function showImageGeneratingToast(
  pendingCount: number,
): string | number {
  // Dismiss any lingering success toast before showing progress
  toast.dismiss(SUCCESS_TOAST_ID);
  return toast.custom(
    (t) => <ImageGeneratingToast pendingCount={pendingCount} toastId={t} />,
    { id: GENERATING_TOAST_ID, duration: Infinity },
  );
}

export function showImageSuccessToast(
  result: GenerateImageResponse,
): string | number {
  // Dismiss the generating toast before showing success
  toast.dismiss(GENERATING_TOAST_ID);
  return toast.custom(
    (t) => <ImageSuccessToast result={result} toastId={t} />,
    {
      id: SUCCESS_TOAST_ID,
      duration: SUCCESS_AUTO_DISMISS_MS,
      onAutoClose: () => restoreGeneratingToastIfNeeded(),
    },
  );
}

export function dismissImageGenerationToast() {
  toast.dismiss(GENERATING_TOAST_ID);
  toast.dismiss(SUCCESS_TOAST_ID);
}
