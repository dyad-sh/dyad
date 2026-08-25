import { useAtom } from "jotai";
import { ChevronDown, ChevronUp, MessageSquare, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chatAnnotationsAtom,
  clearChatAnnotations,
  pruneChatAnnotations,
  removeChatAnnotation,
} from "@/atoms/chatAnnotationAtoms";
import { Button } from "@/components/ui/button";
import {
  useChatMessages,
  useChatMessagesLoaded,
} from "@/hooks/useChatMessages";

export function ChatAnnotationsTray({ chatId }: { chatId: number }) {
  const { t } = useTranslation("chat");
  const [allAnnotations, setAllAnnotations] = useAtom(chatAnnotationsAtom);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const messages = useChatMessages(chatId);
  const messagesLoaded = useChatMessagesLoaded(chatId);
  const annotations = useMemo(
    () => allAnnotations.get(chatId) ?? [],
    [allAnnotations, chatId],
  );

  // Retry deletes the trailing assistant message server-side, and so does
  // clearing a chat's history. Reconcile against the loaded messages so the
  // tray never submits a comment quoting a message that is gone. Gate on
  // `messagesLoaded`, not on the list being non-empty: a cleared chat loads as
  // an empty list, and that is exactly when everything needs pruning.
  useEffect(() => {
    if (!messagesLoaded) return;
    const messageIds = new Set(messages.map((message) => message.id));
    setAllAnnotations((previous) =>
      pruneChatAnnotations(previous, chatId, messageIds),
    );
  }, [chatId, messages, messagesLoaded, setAllAnnotations]);

  if (annotations.length === 0) return null;

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
          aria-expanded={expanded}
          aria-controls={listId}
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
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={t("annotations.discard")}
          onClick={() =>
            setAllAnnotations((previous) =>
              clearChatAnnotations(previous, chatId),
            )
          }
        >
          <X className="size-4" />
        </Button>
      </div>
      {expanded && (
        <div
          id={listId}
          className="max-h-48 space-y-2 overflow-y-auto border-t px-3 py-2"
        >
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
