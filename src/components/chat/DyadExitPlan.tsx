import React, { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { CheckCircle, ArrowRight } from "lucide-react";
import { planStateAtom } from "@/atoms/planAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

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
  const planState = useAtomValue(planStateAtom);
  const isTransitioning = chatId
    ? planState.transitioningChatIds.has(chatId)
    : false;

  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    if (!isTransitioning) return;
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, [isTransitioning]);

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
              ? `Preparing a new chat${".".repeat(dotCount + 1)}`
              : "Opening new chat for implementation"}
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
