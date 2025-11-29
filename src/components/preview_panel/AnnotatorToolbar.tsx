import {
  MousePointer2,
  Pencil,
  Type,
  Trash2,
  Undo,
  Redo,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnnotatorToolbarProps {
  tool: "select" | "draw" | "text";
  selectedId: string | null;
  historyStep: number;
  historyLength: number;
  onToolChange: (tool: "select" | "draw" | "text") => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSubmit: () => void;
  hasSubmitHandler: boolean;
}

export const AnnotatorToolbar = ({
  tool,
  selectedId,
  historyStep,
  historyLength,
  onToolChange,
  onDelete,
  onUndo,
  onRedo,
  onSubmit,
  hasSubmitHandler,
}: AnnotatorToolbarProps) => {
  return (
    <div className="absolute flex items-center p-2 gap-1 bg-[var(--background)] rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-[1000] top-4 left-1/2 transform -translate-x-1/2">
      <button
        onClick={() => onToolChange("select")}
        className={cn(
          "p-1 rounded transition-colors duration-200",
          tool === "select"
            ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
            : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
        )}
        title="Select (V)"
      >
        <MousePointer2 size={16} />
      </button>
      <button
        onClick={() => onToolChange("draw")}
        className={cn(
          "p-1 rounded transition-colors duration-200",
          tool === "draw"
            ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
            : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
        )}
        title="Draw (P)"
      >
        <Pencil size={16} />
      </button>
      <button
        onClick={() => onToolChange("text")}
        className={cn(
          "p-1 rounded transition-colors duration-200",
          tool === "text"
            ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
            : "text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
        )}
        title="Text (T)"
      >
        <Type size={16} />
      </button>

      <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

      <button
        onClick={onDelete}
        className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900"
        title="Delete Selected (Del)"
        disabled={!selectedId}
      >
        <Trash2 size={16} />
      </button>

      <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

      <button
        onClick={onUndo}
        className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900"
        title="Undo"
        disabled={historyStep === 0}
      >
        <Undo size={16} />
      </button>
      <button
        onClick={onRedo}
        className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900"
        title="Redo"
        disabled={historyStep === historyLength - 1}
      >
        <Redo size={16} />
      </button>

      <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

      <button
        onClick={onSubmit}
        className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200 dark:text-purple-300 dark:hover:bg-purple-900"
        title="Submit to Chat"
        disabled={!hasSubmitHandler}
      >
        <Check size={16} />
      </button>
    </div>
  );
};
