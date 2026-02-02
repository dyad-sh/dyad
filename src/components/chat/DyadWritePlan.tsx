import React, { useState } from "react";
import { FileText, Eye, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useSetAtom } from "jotai";
import { previewModeAtom } from "@/atoms/appAtoms";
import { CustomTagState } from "./stateTypes";
import { usePlan } from "@/hooks/usePlan";

interface DyadWritePlanProps {
  node: {
    properties: {
      title: string;
      summary?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadWritePlan: React.FC<DyadWritePlanProps> = ({ node }) => {
  const { title, summary, complete, state } = node.properties;
  const [showSummary, setShowSummary] = useState(false);
  const setPreviewMode = useSetAtom(previewModeAtom);

  // Consider in progress if state is pending OR complete is explicitly "false"
  const isInProgress = state === "pending" || complete === "false";

  const { savedPlan, hasPlanInMemory } = usePlan({ enabled: !isInProgress });

  const hasPlan = hasPlanInMemory || !!savedPlan;

  return (
    <div
      className={`my-4 border rounded-lg overflow-hidden ${
        isInProgress ? "border-primary/60" : "border-primary/20"
      } bg-primary/5`}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText
            className={`text-primary ${isInProgress ? "animate-pulse" : ""}`}
            size={20}
          />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{title}</span>
            {summary && (
              <button
                type="button"
                onClick={() => setShowSummary(!showSummary)}
                className="text-primary hover:text-primary/80 transition-colors"
                aria-label={showSummary ? "Hide summary" : "Show summary"}
              >
                {showSummary ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center">
          {!isInProgress && hasPlan && (
            <button
              type="button"
              onClick={() => setPreviewMode("plan")}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-foreground px-4 py-1.5 bg-primary rounded-md hover:bg-primary/90 transition-colors"
            >
              <Eye size={14} />
              View Plan
            </button>
          )}
          {isInProgress && (
            <span className="flex items-center gap-1.5 text-xs text-primary px-3 py-1 bg-primary/20 rounded-md font-medium">
              <Loader2 size={12} className="animate-spin" />
              Generating plan...
            </span>
          )}
        </div>
      </div>
      {isInProgress && (
        <div className="px-4 pb-3">
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.3) 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}
      {summary && showSummary && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-sm text-muted-foreground pl-7">{summary}</p>
        </div>
      )}
    </div>
  );
};
