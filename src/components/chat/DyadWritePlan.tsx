import React, { useState, useEffect } from "react";
import { FileText, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useSetAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  planContentByChatIdAtom,
  planTitleByChatIdAtom,
  planSummaryByChatIdAtom,
} from "@/atoms/planAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { planClient } from "@/ipc/types/plan";

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
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const planContent = useAtomValue(planContentByChatIdAtom);
  const setPlanContent = useSetAtom(planContentByChatIdAtom);
  const setPlanTitle = useSetAtom(planTitleByChatIdAtom);
  const setPlanSummary = useSetAtom(planSummaryByChatIdAtom);

  // Consider in progress if state is pending OR complete is explicitly "false"
  const isInProgress = state === "pending" || complete === "false";
  const hasPlanInMemory = chatId ? planContent.has(chatId) : false;

  // Query for saved plan in database
  const { data: savedPlan } = useQuery({
    queryKey: ["plan", "forChat", appId, chatId],
    queryFn: async () => {
      if (!appId || !chatId) return null;
      return planClient.getPlanForChat({ appId, chatId });
    },
    enabled: !!appId && !!chatId && !hasPlanInMemory && !isInProgress,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Load saved plan into memory atoms if found
  useEffect(() => {
    if (savedPlan && chatId && !hasPlanInMemory) {
      setPlanContent((prev) => {
        const next = new Map(prev);
        next.set(chatId, savedPlan.content);
        return next;
      });
      setPlanTitle((prev) => {
        const next = new Map(prev);
        next.set(chatId, savedPlan.title);
        return next;
      });
      if (savedPlan.summary) {
        setPlanSummary((prev) => {
          const next = new Map(prev);
          next.set(chatId, savedPlan.summary!);
          return next;
        });
      }
    }
  }, [
    savedPlan,
    chatId,
    hasPlanInMemory,
    setPlanContent,
    setPlanTitle,
    setPlanSummary,
  ]);

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
            <span className="text-xs text-primary px-3 py-1 bg-primary/20 rounded-md font-medium">
              Writing...
            </span>
          )}
        </div>
      </div>
      {summary && showSummary && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-sm text-muted-foreground pl-7">{summary}</p>
        </div>
      )}
    </div>
  );
};
