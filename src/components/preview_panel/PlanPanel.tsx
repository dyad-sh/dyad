import React, { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Check, FileText } from "lucide-react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import { planStateAtom } from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { usePlan } from "@/hooks/usePlan";
import { useSettings } from "@/hooks/useSettings";

export const PlanPanel: React.FC = () => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const planState = useAtomValue(planStateAtom);
  const previewMode = useAtomValue(previewModeAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const { savedPlan } = usePlan();
  const { settings } = useSettings();

  const planData = chatId ? planState.plansByChatId.get(chatId) : null;
  const currentPlan = planData?.content ?? null;
  const currentTitle = planData?.title ?? null;
  const currentSummary = planData?.summary ?? null;
  const isAccepted = chatId ? planState.acceptedChatIds.has(chatId) : false;
  // Plan was already saved if we found it in the filesystem
  const isSavedPlan = !!savedPlan;

  // If there's no plan content, switch back to preview mode
  useEffect(() => {
    if (!currentPlan && previewMode === "plan") {
      setPreviewMode("preview");
    }
  }, [currentPlan, previewMode, setPreviewMode]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = () => {
    if (!chatId) return;
    if (settings?.selectedChatMode !== "plan") return;
    if (isSubmitting) return;
    setIsSubmitting(true);

    streamMessage({
      chatId,
      prompt:
        "I accept this plan. Call the exit_plan tool now with confirmation: true to begin implementation.",
    });
  };

  // Don't render anything if there's no plan - effect will switch to preview mode
  if (!currentPlan) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="border rounded-lg bg-card">
          <div className="px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <FileText className="text-blue-500" size={20} />
              <h2 className="text-lg font-semibold">
                {currentTitle || "Implementation Plan"}
              </h2>
            </div>
            {currentSummary && (
              <p className="text-sm text-muted-foreground mt-1">
                {currentSummary}
              </p>
            )}
          </div>
          <div className="p-4">
            <div className="prose dark:prose-invert prose-sm max-w-none">
              <VanillaMarkdownParser content={currentPlan} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t p-4 space-y-4 bg-background">
        {isAccepted || isSavedPlan ? (
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Check size={16} />
            <span className="text-sm font-medium">
              Plan accepted — implementation started in a new chat
            </span>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={handleAccept}
              disabled={isStreaming || isSubmitting}
              className="flex-1"
            >
              <Check size={16} className="mr-2" />
              Accept Plan
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
