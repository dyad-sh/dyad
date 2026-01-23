import {
  MousePointer2,
  Pencil,
  Type,
  Trash2,
  Undo,
  Redo,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToolbarColorPicker } from "./ToolbarColorPicker";

interface AnnotatorToolbarProps {
  tool: "select" | "draw" | "text";
  color: string;
  selectedId: string | null;
  historyStep: number;
  historyLength: number;
  onToolChange: (tool: "select" | "draw" | "text") => void;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSubmit: () => void;
  onDeactivate: () => void;
  hasSubmitHandler: boolean;
}

export const AnnotatorToolbar = ({
  tool,
  color,
  selectedId,
  historyStep,
  historyLength,
  onToolChange,
  onColorChange,
  onDelete,
  onUndo,
  onRedo,
  onSubmit,
  onDeactivate,
  hasSubmitHandler,
}: AnnotatorToolbarProps) => {
  return (
    <div className="flex items-center justify-center p-2 border-b space-x-2">
      <TooltipProvider>
        {/* Tool Selection Buttons */}
        <div className="flex space-x-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToolChange("select")}
                aria-label="Select"
                className={cn(
                  "p-1 rounded transition-colors duration-200",
                  tool === "select"
                    ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
                    : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
                )}
              >
                <MousePointer2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Select</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToolChange("draw")}
                aria-label="Draw"
                className={cn(
                  "p-1 rounded transition-colors duration-200",
                  tool === "draw"
                    ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
                    : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
                )}
              >
                <Pencil size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Draw</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToolChange("text")}
                aria-label="Text"
                className={cn(
                  "p-1 rounded transition-colors duration-200",
                  tool === "text"
                    ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
                    : "text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900",
                )}
              >
                <Type size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Text</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-1 rounded transition-colors duration-200 hover:bg-purple-200 dark:hover:bg-purple-900">
                <ToolbarColorPicker color={color} onChange={onColorChange} />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Color</p>
            </TooltipContent>
          </Tooltip>

          <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDelete}
                aria-label="Delete"
                className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedId}
              >
                <Trash2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete Selected</p>
            </TooltipContent>
          </Tooltip>

          <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onUndo}
                aria-label="Undo"
                className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={historyStep === 0}
              >
                <Undo size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Undo</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRedo}
                aria-label="Redo"
                className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={historyStep === historyLength - 1}
              >
                <Redo size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Redo</p>
            </TooltipContent>
          </Tooltip>

          <div className="w-px bg-gray-200 dark:bg-gray-700 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSubmit}
                aria-label="Add to Chat"
                className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200 dark:text-purple-300 dark:hover:bg-purple-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!hasSubmitHandler}
              >
                <Check size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Add to Chat</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDeactivate}
                aria-label="Close Annotator"
                className="p-1 rounded transition-colors duration-200 text-purple-700 hover:bg-purple-200 dark:text-purple-300 dark:hover:bg-purple-900"
              >
                <X size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Close Annotator</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
};
