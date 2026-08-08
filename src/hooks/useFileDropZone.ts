import { useCallback, useRef, useState } from "react";

/**
 * Drag-and-drop onto a surface.
 *
 * `dragenter`/`dragleave` fire for every child element the pointer crosses, so
 * a naive boolean flickers as the cursor moves over the composer's buttons.
 * Counting enters and leaves is what makes the highlight stable.
 */
export function useFileDropZone({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  /** True only for an actual file drag — not text selections or links. */
  const carriesFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depthRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      // Without this the browser opens the file instead of letting us have it.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depthRef.current -= 1;
      if (depthRef.current <= 0) reset();
    },
    [disabled, reset],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer.files ?? []);
      // Dropping a folder yields a zero-byte entry with no type; ignore those
      // rather than attaching something unreadable.
      const usable = files.filter((file) => file.size > 0 || file.type);
      if (usable.length > 0) onFiles(usable);
    },
    [disabled, onFiles, reset],
  );

  return {
    isDragging,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
