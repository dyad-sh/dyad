import type React from "react";
import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";

interface ImageLightboxProps {
  imageUrl: string;
  alt: string;
  filePath?: string;
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

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  imageUrl,
  alt,
  filePath,
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
        {filePath && (
          <button
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              openFile(filePath);
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
