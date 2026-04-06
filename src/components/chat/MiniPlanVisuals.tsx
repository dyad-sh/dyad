import React, { useState, useCallback } from "react";
import {
  Image,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  MiniPlanVisual,
  MiniPlanVisualEditableField,
} from "@/ipc/types/mini_plan";
import type { CustomTagState } from "./stateTypes";

const VISUAL_TYPES = [
  "logo",
  "photo",
  "illustration",
  "icon",
  "background",
  "other",
] as const;

type VisualType = (typeof VISUAL_TYPES)[number];

interface MiniPlanVisualsProps {
  visuals: MiniPlanVisual[];
  state?: CustomTagState;
  isApproved?: boolean;
  onEditVisual?: (
    visualId: string,
    field: MiniPlanVisualEditableField,
    value: string,
  ) => void;
  onAddVisual?: (visual: Omit<MiniPlanVisual, "id">) => void;
  onRemoveVisual?: (visualId: string) => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  logo: {
    label: "Logo",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  photo: {
    label: "Photo",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  illustration: {
    label: "Illustration",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  icon: {
    label: "Icon",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  background: {
    label: "Background",
    color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  other: {
    label: "Other",
    color:
      "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  },
};

interface EditableTextProps {
  value: string;
  visualId: string;
  field: MiniPlanVisualEditableField;
  canEdit: boolean;
  onEdit?: (
    visualId: string,
    field: MiniPlanVisualEditableField,
    value: string,
  ) => void;
  multiline?: boolean;
  className?: string;
}

const EditableText: React.FC<EditableTextProps> = ({
  value,
  visualId,
  field,
  canEdit,
  onEdit,
  multiline,
  className,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      onEdit?.(visualId, field, trimmed);
    } else {
      setEditValue(value);
    }
    setIsEditing(false);
  }, [editValue, value, visualId, field, onEdit]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setIsEditing(false);
  }, [value]);

  if (isEditing) {
    return (
      <div className="space-y-1.5">
        {multiline ? (
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full text-xs font-mono bg-background border border-primary/40 focus:border-primary rounded p-2 text-foreground outline-none resize-y min-h-[60px]"
            autoFocus
          />
        ) : (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full text-sm bg-background border border-primary/40 focus:border-primary rounded px-2 py-1 text-foreground outline-none"
            autoFocus
          />
        )}
        <div className="flex items-center gap-1.5 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors"
            aria-label={`Cancel editing ${field}`}
          >
            <X size={12} />
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 px-2 py-0.5 rounded transition-colors"
            aria-label={`Save ${field}`}
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    );
  }

  if (multiline) {
    return (
      <div className="group relative">
        <p className={className}>{value}</p>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setEditValue(value);
              setIsEditing(true);
            }}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded"
            aria-label={`Edit ${field}`}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
    );
  }

  return canEdit ? (
    <button
      type="button"
      onClick={() => {
        setEditValue(value);
        setIsEditing(true);
      }}
      className={`${className} cursor-text text-left inline-flex items-center gap-1 group/inline hover:text-primary transition-colors`}
      aria-label={`Edit ${field}`}
    >
      <span className="truncate">{value}</span>
      <Pencil
        size={11}
        className="shrink-0 opacity-0 group-hover/inline:opacity-100 transition-opacity text-muted-foreground"
      />
    </button>
  ) : (
    <p className={className}>{value}</p>
  );
};

const VisualEntry: React.FC<{
  visual: MiniPlanVisual;
  isApproved?: boolean;
  onEdit?: (
    visualId: string,
    field: MiniPlanVisualEditableField,
    value: string,
  ) => void;
  onRemove?: (visualId: string) => void;
}> = ({ visual, isApproved, onEdit, onRemove }) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const typeInfo = TYPE_LABELS[visual.type] ?? TYPE_LABELS.other;
  const canEdit = !isApproved && !!onEdit;
  const canRemove = !isApproved && !!onRemove;

  return (
    <div className="border border-border/50 rounded-md p-2.5 space-y-1.5 group/entry">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${typeInfo.color}`}
          >
            {typeInfo.label}
          </span>
          <EditableText
            value={visual.description}
            visualId={visual.id}
            field="description"
            canEdit={canEdit}
            onEdit={onEdit}
            className="text-sm text-foreground/80 truncate"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(visual.id)}
              className="opacity-0 group-hover/entry:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5 rounded"
              aria-label="Remove visual"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPrompt(!showPrompt)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={showPrompt ? "Hide prompt" : "Show prompt"}
          >
            {showPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {showPrompt && (
        <EditableText
          value={visual.prompt}
          visualId={visual.id}
          field="prompt"
          canEdit={canEdit}
          onEdit={onEdit}
          multiline
          className="text-xs text-muted-foreground bg-muted/30 rounded p-2 font-mono"
        />
      )}
    </div>
  );
};

const AddVisualForm: React.FC<{
  onAdd: (visual: Omit<MiniPlanVisual, "id">) => void;
  onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
  const [type, setType] = useState<VisualType>("other");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmedDesc = description.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedDesc || !trimmedPrompt) return;
    onAdd({ type, description: trimmedDesc, prompt: trimmedPrompt });
  }, [type, description, prompt, onAdd]);

  return (
    <div className="border border-primary/40 rounded-md p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as VisualType)}
          className="text-xs bg-background border border-border/50 rounded px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          aria-label="Visual type"
        >
          {VISUAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t].label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="flex-1 text-sm bg-background border border-border/50 rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          autoFocus
        />
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Image generation prompt..."
        className="w-full text-xs font-mono bg-background border border-border/50 rounded p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y min-h-[48px]"
      />
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!description.trim() || !prompt.trim()}
          className="flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 px-2 py-0.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          Add
        </button>
      </div>
    </div>
  );
};

export const MiniPlanVisuals: React.FC<MiniPlanVisualsProps> = ({
  visuals,
  state,
  isApproved,
  onEditVisual,
  onAddVisual,
  onRemoveVisual,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const canAdd = !isApproved && !!onAddVisual;

  if (visuals.length === 0 && state === "pending") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Image size={14} className="animate-pulse" />
        <span>Planning visuals...</span>
      </div>
    );
  }

  if (visuals.length === 0 && !canAdd) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Visual Assets ({visuals.length})
          </span>
        </div>
        {canAdd && !showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            aria-label="Add visual"
          >
            <Plus size={13} />
            Add
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {visuals.map((visual) => (
          <VisualEntry
            key={visual.id}
            visual={visual}
            isApproved={isApproved}
            onEdit={onEditVisual}
            onRemove={onRemoveVisual}
          />
        ))}
        {showAddForm && onAddVisual && (
          <AddVisualForm
            onAdd={(visual) => {
              onAddVisual(visual);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>
    </div>
  );
};
