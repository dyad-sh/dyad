import React, { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Check, FileText, Save } from "lucide-react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import { planStateAtom } from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { usePlan } from "@/hooks/usePlan";

export const PlanPanel: React.FC = () => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const planState = useAtomValue(planStateAtom);
  const setPlanState = useSetAtom(planStateAtom);
  const previewMode = useAtomValue(previewModeAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const { savedPlan } = usePlan();

  const planData = chatId ? planState.plansByChatId.get(chatId) : null;
  const currentPlan = planData?.content ?? null;
  const currentTitle = planData?.title ?? null;
  const currentSummary = planData?.summary ?? null;
  const shouldPersist = planState.shouldPersist;
  const isAccepted = chatId ? planState.acceptedChatIds.has(chatId) : false;
  // Plan was already saved if we found it in the filesystem
  const isSavedPlan = !!savedPlan;

  // If there's no plan content, switch back to preview mode
  useEffect(() => {
    if (!currentPlan && previewMode === "plan") {
      setPreviewMode("preview");
    }
  }, [currentPlan, previewMode, setPreviewMode]);

  const handleAccept = () => {
    if (!chatId) return;

    streamMessage({
      chatId,
      prompt:
        "I accept this implementation plan. Please proceed with the implementation.",
    });
  };

  const handlePersistChange = (checked: boolean) => {
    setPlanState((prev) => ({
      ...prev,
      shouldPersist: checked,
    }));
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
        {isAccepted ? (
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Check size={16} />
            <span className="text-sm font-medium">
              Plan accepted — implementation started in a new chat
            </span>
          </div>
        ) : isSavedPlan ? (
          <div className="flex items-center gap-2 text-primary">
            <Save size={16} />
            <span className="text-sm font-medium">
              Plan already accepted and saved
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="persist-plan"
                checked={shouldPersist}
                onCheckedChange={(checked) =>
                  handlePersistChange(checked === true)
                }
              />
              <Label
                htmlFor="persist-plan"
                className="text-sm font-normal cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <Save size={14} />
                  Save plan for later reference
                </div>
              </Label>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleAccept}
                disabled={isStreaming}
                className="flex-1"
              >
                <Check size={16} className="mr-2" />
                Accept Plan
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
