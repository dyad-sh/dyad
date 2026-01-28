import React from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Check, FileText, Save } from "lucide-react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import {
  planContentByChatIdAtom,
  planTitleByChatIdAtom,
  planSummaryByChatIdAtom,
  planShouldPersistAtom,
} from "@/atoms/planAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";

export const PlanPanel: React.FC = () => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const planContent = useAtomValue(planContentByChatIdAtom);
  const planTitle = useAtomValue(planTitleByChatIdAtom);
  const planSummary = useAtomValue(planSummaryByChatIdAtom);
  const shouldPersist = useAtomValue(planShouldPersistAtom);
  const setShouldPersist = useSetAtom(planShouldPersistAtom);
  const { streamMessage, isStreaming } = useStreamChat();

  const currentPlan = chatId ? planContent.get(chatId) : null;
  const currentTitle = chatId ? planTitle.get(chatId) : null;
  const currentSummary = chatId ? planSummary.get(chatId) : null;

  const handleAccept = () => {
    if (!chatId) return;

    streamMessage({
      chatId,
      prompt:
        "I accept this implementation plan. Please proceed with the implementation.",
    });
  };

  if (!currentPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <FileText className="text-muted-foreground mb-4" size={48} />
        <h3 className="text-lg font-medium mb-2">No Plan Yet</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          The implementation plan will appear here once the AI creates it. Start
          by describing what you want to build in the chat.
        </p>
      </div>
    );
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
        <div className="flex items-center space-x-2">
          <Checkbox
            id="persist-plan"
            checked={shouldPersist}
            onCheckedChange={(checked) => setShouldPersist(checked === true)}
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
      </div>
    </div>
  );
};
