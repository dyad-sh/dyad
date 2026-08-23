import { atom } from "jotai";

export interface ChatAnnotation {
  id: string;
  chatId: number;
  messageId: number;
  selectedText: string;
  comment: string;
  createdAt: number;
  startOffset: number;
  selectionLength: number;
}

export type ChatAnnotationsMap = Map<number, ChatAnnotation[]>;

export const chatAnnotationsAtom = atom<ChatAnnotationsMap>(new Map());

export function addChatAnnotation(
  previous: ChatAnnotationsMap,
  annotation: ChatAnnotation,
): ChatAnnotationsMap {
  const next = new Map(previous);
  next.set(annotation.chatId, [
    ...(next.get(annotation.chatId) ?? []),
    annotation,
  ]);
  return next;
}

export function updateChatAnnotation(
  previous: ChatAnnotationsMap,
  chatId: number,
  annotationId: string,
  comment: string,
): ChatAnnotationsMap {
  const next = new Map(previous);
  next.set(
    chatId,
    (next.get(chatId) ?? []).map((annotation) =>
      annotation.id === annotationId
        ? { ...annotation, comment: comment.trim() }
        : annotation,
    ),
  );
  return next;
}

export function removeChatAnnotation(
  previous: ChatAnnotationsMap,
  chatId: number,
  annotationId: string,
): ChatAnnotationsMap {
  const next = new Map(previous);
  const remaining = (next.get(chatId) ?? []).filter(
    (annotation) => annotation.id !== annotationId,
  );
  if (remaining.length === 0) next.delete(chatId);
  else next.set(chatId, remaining);
  return next;
}

export function clearChatAnnotations(
  previous: ChatAnnotationsMap,
  chatId: number,
): ChatAnnotationsMap {
  const next = new Map(previous);
  next.delete(chatId);
  return next;
}

export function hasOverlappingChatAnnotation(
  annotations: ChatAnnotation[],
  startOffset: number,
  selectionLength: number,
): boolean {
  const endOffset = startOffset + selectionLength;
  return annotations.some((annotation) => {
    const annotationEnd = annotation.startOffset + annotation.selectionLength;
    return startOffset < annotationEnd && annotation.startOffset < endOffset;
  });
}
