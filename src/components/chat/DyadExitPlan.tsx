import React, { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { AlertCircle, CheckCircle, ArrowRight } from "lucide-react";
import { planAcceptInNewChatByChatIdAtom } from "@/atoms/planAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { usePlanHandoffState } from "@/plan_handoff/usePlanHandoff";

interface DyadExitPlanProps {
  node: {
    properties: {
      notes?: string;
    };
  };
}

export const DyadExitPlan: React.FC<DyadExitPlanProps> = ({ node }) => {
  const { notes } = node.properties;
  const chatId = useAtomValue(selectedChatIdAtom);
  const acceptInNewChatByChatId = useAtomValue(planAcceptInNewChatByChatIdAtom);
  const handoffState = usePlanHandoffState(chatId);
  const failure =
    "phase" in handoffState
      ? handoffState.phase === "failed"
        ? (handoffState.failure ?? "Plan implementation could not be started.")
        : null
      : handoffState.type === "failed"
        ? (handoffState.error ?? "Plan implementation could not be started.")
        : null;
  const isTransitioning =
    ("type" in handoffState && handoffState.type === "transitioning") ||
    ("phase" in handoffState &&
      handoffState.phase !== "idle" &&
      handoffState.phase !== "started" &&
      handoffState.phase !== "failed" &&
      handoffState.phase !== "cancelled");
  // Defaults to continuing in the current chat when the choice is unknown
  // (typed acceptance, or after a reload), matching usePlanHandoff routing.
  const useNewChat = chatId
    ? (acceptInNewChatByChatId.get(chatId) ?? false)
    : false;

  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    if (!isTransitioning) return;
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, [isTransitioning]);

  if (failure) {
    return (
      <div className="my-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <AlertCircle className="shrink-0 text-red-500" size={24} />
        <div>
          <div className="font-semibold text-red-800 dark:text-red-200">
            Failed to start plan implementation
          </div>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {failure}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <CheckCircle className="text-green-500 flex-shrink-0" size={24} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-green-800 dark:text-green-200">
            Plan Accepted
          </span>
          <ArrowRight className="text-green-500" size={16} />
          <span className="text-green-700 dark:text-green-300">
            {isTransitioning
              ? useNewChat
                ? `Preparing a new chat${".".repeat(dotCount + 1)}`
                : `Preparing implementation${".".repeat(dotCount + 1)}`
              : useNewChat
                ? "Opening new chat for implementation"
                : "Continuing implementation in this chat"}
          </span>
        </div>
        {notes && (
          <p className="text-sm text-green-600 dark:text-green-400 mt-1">
            {notes}
          </p>
        )}
      </div>
    </div>
  );
};
