import React, { useState } from "react";
import { Image, ChevronDown, ChevronUp } from "lucide-react";
import type { MiniPlanVisual } from "@/ipc/types/mini_plan";
import type { CustomTagState } from "./stateTypes";

interface MiniPlanVisualsProps {
  visuals: MiniPlanVisual[];
  state?: CustomTagState;
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

const VisualEntry: React.FC<{ visual: MiniPlanVisual }> = ({ visual }) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const typeInfo = TYPE_LABELS[visual.type] ?? TYPE_LABELS.other;

  return (
    <div className="border border-border/50 rounded-md p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeInfo.color}`}
          >
            {typeInfo.label}
          </span>
          <span className="text-sm text-foreground/80 truncate">
            {visual.description}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowPrompt(!showPrompt)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={showPrompt ? "Hide prompt" : "Show prompt"}
        >
          {showPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {showPrompt && (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2 font-mono">
          {visual.prompt}
        </p>
      )}
    </div>
  );
};

export const MiniPlanVisuals: React.FC<MiniPlanVisualsProps> = ({
  visuals,
  state,
}) => {
  if (visuals.length === 0 && state === "pending") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Image size={14} className="animate-pulse" />
        <span>Planning visuals...</span>
      </div>
    );
  }

  if (visuals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Image size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Visual Assets ({visuals.length})
        </span>
      </div>
      <div className="space-y-1.5">
        {visuals.map((visual) => (
          <VisualEntry key={visual.id} visual={visual} />
        ))}
      </div>
    </div>
  );
};
