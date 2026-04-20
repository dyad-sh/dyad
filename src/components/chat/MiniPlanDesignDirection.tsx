import React, { useState, useCallback } from "react";
import { Compass, Pencil, Check, X, Plus } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";

interface MiniPlanDesignDirectionProps {
  direction: string;
  isApproved?: boolean;
  onEdit?: (value: string) => void;
}

export const MiniPlanDesignDirection: React.FC<
  MiniPlanDesignDirectionProps
> = ({ direction, isApproved, onEdit }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(direction);
  const canEdit = !isApproved && !!onEdit;

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== direction) {
      onEdit?.(trimmed);
    } else {
      setEditValue(direction);
    }
    setIsEditing(false);
  }, [editValue, direction, onEdit]);

  const handleCancel = useCallback(() => {
    setEditValue(direction);
    setIsEditing(false);
  }, [direction]);

  if (isEditing) {
    return (
      <div className="space-y-1.5">
        <textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="w-full text-sm bg-background border border-primary/40 focus:border-primary rounded p-2 text-foreground outline-none resize-y min-h-[60px]"
          autoFocus
        />
        <div className="flex items-center gap-1.5 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors"
            aria-label="Cancel editing"
          >
            <X size={12} />
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 px-2 py-0.5 rounded transition-colors"
            aria-label="Save design direction"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    );
  }

  if (!direction) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        onClick={() => {
          setEditValue("");
          setIsEditing(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        aria-label="Add design direction"
      >
        <Plus size={13} />
        Add design direction
      </button>
    );
  }

  return (
    <div className="group relative flex items-start gap-2">
      <Compass size={14} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="text-sm text-foreground/80 [&_p]:m-0 [&_p]:leading-relaxed">
        <VanillaMarkdownParser content={direction} />
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setEditValue(direction);
            setIsEditing(true);
          }}
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded"
          aria-label="Edit design direction"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
};
