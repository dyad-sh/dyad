import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Check, FileText } from "lucide-react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import {
  clearPlanAnnotations,
  planAnnotationsAtom,
  planStateAtom,
} from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { usePlan } from "@/hooks/usePlan";
import { useChatMode } from "@/hooks/useChatMode";
import { SelectionCommentButton } from "./plan/SelectionCommentButton";
import { CommentsFloatingButton } from "./plan/CommentsFloatingButton";
import { CommentPopover } from "./plan/CommentPopover";
import {
  applyPlanAnnotationHighlights,
  clearPlanAnnotationHighlights,
} from "./plan/planAnnotationDom";

export const PlanPanel: React.FC = () => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const planState = useAtomValue(planStateAtom);
  const previewMode = useAtomValue(previewModeAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const { savedPlan } = usePlan();
  const { selectedMode } = useChatMode(chatId);

  const annotations = useAtomValue(planAnnotationsAtom);
  const planContentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  const setAnnotations = useSetAtom(planAnnotationsAtom);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingComments, setIsSendingComments] = useState(false);

  const chatAnnotations = useMemo(
    () => (chatId ? (annotations.get(chatId) ?? []) : []),
    [chatId, annotations],
  );

  // Highlight annotated text in the plan content
  useEffect(() => {
    const container = planContentRef.current;
    if (!container) return;

    if (chatAnnotations.length === 0) {
      clearPlanAnnotationHighlights(container);
      return;
    }

    let frameId: number | null = null;
    let isApplyingHighlights = false;

    const observer = new MutationObserver(() => {
      if (isApplyingHighlights) {
        return;
      }
      scheduleHighlightRefresh();
    });

    const refreshHighlights = () => {
      observer.disconnect();
      isApplyingHighlights = true;

      try {
        clearPlanAnnotationHighlights(container);
        applyPlanAnnotationHighlights(container, chatAnnotations);
      } finally {
        isApplyingHighlights = false;
        observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    };

    const scheduleHighlightRefresh = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        refreshHighlights();
      });
    };

    scheduleHighlightRefresh();
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      clearPlanAnnotationHighlights(container);
    };
  }, [chatAnnotations, currentPlan]);

  const handleSendComments = useCallback(() => {
    if (!chatId || isSendingComments) return;
    const currentAnnotations = annotations.get(chatId) ?? [];
    if (currentAnnotations.length === 0) return;

    const prompt = currentAnnotations
      .map(
        (a, i) => `**Comment ${i + 1}:**\n> ${a.selectedText}\n\n${a.comment}`,
      )
      .join("\n\n---\n\n");

    setIsSendingComments(true);
    streamMessage({
      chatId,
      prompt: `I have the following comments on the plan:\n\n${prompt}\n\nPlease update the plan based on these comments.`,
      onSettled: ({ success }) => {
        if (success) {
          setAnnotations((prev) => clearPlanAnnotations(prev, chatId));
        }
        setIsSendingComments(false);
      },
    });
  }, [chatId, isSendingComments, annotations, streamMessage, setAnnotations]);

  const handleAccept = () => {
    if (!chatId) return;
    if (selectedMode !== "plan") return;
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
      <div className="flex-1 overflow-hidden">
        <div
          className="relative h-full overflow-y-auto p-4"
          ref={scrollContainerRef}
        >
          {chatId && (
            <CommentsFloatingButton
              chatId={chatId}
              annotations={chatAnnotations}
              onSendComments={handleSendComments}
              isSending={isSendingComments}
            />
          )}
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
              <div
                ref={planContentRef}
                data-testid="plan-content"
                className="prose dark:prose-invert prose-sm max-w-none"
              >
                <VanillaMarkdownParser content={currentPlan} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {chatId && (
        <>
          <SelectionCommentButton
            key={chatId}
            containerRef={planContentRef}
            scrollRef={scrollContainerRef}
            chatId={chatId}
            chatAnnotations={chatAnnotations}
          />
          <CommentPopover
            containerRef={planContentRef}
            scrollRef={scrollContainerRef}
            chatId={chatId}
            annotations={chatAnnotations}
          />
        </>
      )}

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
