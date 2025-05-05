import { Paperclip } from "lucide-react";

interface DragDropOverlayProps {
  isDraggingOver: boolean;
}

export function DragDropOverlay({ isDraggingOver }: DragDropOverlayProps) {
  if (!isDraggingOver) return null;

  return (
    <div className="absolute inset-0 bg-blue-100/30 dark:bg-blue-900/30 flex items-center justify-center rounded-lg z-10 pointer-events-none">
      <div className="bg-background p-4 rounded-lg shadow-lg text-center">
        <Paperclip className="mx-auto mb-2 text-blue-500" />
        <p className="text-sm font-medium">Drop files to attach</p>
      </div>
    </div>
  );
}
