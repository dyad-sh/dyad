import type React from "react";
import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";

interface ImageLightboxProps {
  imageUrl: string;
  alt: string;
  filePath?: string;
  mediaFile?: { appId: number; fileName: string };
  onClose: () => void;
  onError?: () => void;
}

export async function openFile(filePath: string) {
  if (!filePath) return;
  try {
    await ipc.system.openFilePath(filePath);
  } catch (error) {
    console.error("Failed to open file:", error);
    toast.error("Could not open file. It may have been moved or deleted.");
  }
}

export async function openMediaFile(appId: number, fileName: string) {
  try {
    await ipc.media.openMediaFile({ appId, fileName });
  } catch (error) {
    console.error("Failed to open media file:", error);
    toast.error("Could not open file. It may have been moved or deleted.");
  }
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  imageUrl,
  alt,
  filePath,
  mediaFile,
  onClose,
  onError,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Expanded image: ${alt}`}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {(filePath || mediaFile) && (
          <button
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              if (filePath) {
                void openFile(filePath);
              } else if (mediaFile) {
                void openMediaFile(mediaFile.appId, mediaFile.fileName);
              }
            }}
            title="Open file"
            aria-label="Open file"
          >
            <ExternalLink size={20} />
          </button>
        )}
        <button
          ref={closeButtonRef}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
      <img
        src={imageUrl}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
        onError={onError}
      />
    </div>
  );
};
