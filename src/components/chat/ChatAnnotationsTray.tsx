import { useAtom } from "jotai";
import { ChevronDown, ChevronUp, MessageSquare, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chatAnnotationsAtom,
  clearChatAnnotations,
  removeChatAnnotation,
} from "@/atoms/chatAnnotationAtoms";
import { Button } from "@/components/ui/button";
import { useStreamChat } from "@/hooks/useStreamChat";
import { serializeChatAnnotations } from "@/lib/serializeChatAnnotations";

export function ChatAnnotationsTray({ chatId }: { chatId: number }) {
  const { t } = useTranslation("chat");
  const [allAnnotations, setAllAnnotations] = useAtom(chatAnnotationsAtom);
  const [expanded, setExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { streamMessage, isStreaming } = useStreamChat();
  const annotations = useMemo(
    () => allAnnotations.get(chatId) ?? [],
    [allAnnotations, chatId],
  );

  if (annotations.length === 0) return null;

  const send = () => {
    if (isSending || isStreaming) return;
    const submittedIds = new Set(annotations.map((annotation) => annotation.id));
    setIsSending(true);
    streamMessage({
      chatId,
      prompt: serializeChatAnnotations(annotations),
      onSettled: ({ success }) => {
        if (success) {
          setAllAnnotations((previous) => {
            const next = new Map(previous);
            const remaining = (next.get(chatId) ?? []).filter(
              (annotation) => !submittedIds.has(annotation.id),
            );
            if (remaining.length === 0) next.delete(chatId);
            else next.set(chatId, remaining);
            return next;
          });
        }
        setIsSending(false);
      },
    });
  };

  return (
    <div
      className="border-b border-border bg-yellow-500/5"
      data-testid="chat-annotations-tray"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <MessageSquare className="size-4 text-yellow-600 dark:text-yellow-400" />
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left text-sm font-medium"
          onClick={() => setExpanded((value) => !value)}
        >
          {t("annotations.commentCount", { count: annotations.length })}
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setAllAnnotations((previous) =>
              clearChatAnnotations(previous, chatId),
            )
          }
        >
          {t("annotations.discard")}
        </Button>
        <Button size="sm" disabled={isStreaming || isSending} onClick={send}>
          {isSending
            ? t("annotations.sending")
            : t("annotations.send", { count: annotations.length })}
        </Button>
      </div>
      {expanded && (
        <div className="max-h-48 space-y-2 overflow-y-auto border-t px-3 py-2">
          {annotations.map((annotation) => (
            <div
              key={annotation.id}
              className="flex gap-2 rounded-md bg-background p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <blockquote className="truncate border-l-2 pl-2 italic text-muted-foreground">
                  {annotation.selectedText}
                </blockquote>
                <p className="mt-1 whitespace-pre-wrap">{annotation.comment}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("annotations.deleteComment")}
                onClick={() =>
                  setAllAnnotations((previous) =>
                    removeChatAnnotation(previous, chatId, annotation.id),
                  )
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
