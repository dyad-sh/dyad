import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";

function quoteSelectedText(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function serializeChatAnnotations(
  annotations: ChatAnnotation[],
): string {
  const comments = [...annotations]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map(
      (annotation, index) =>
        `## Comment ${index + 1}\n\nFrom assistant message ${annotation.messageId}:\n\n${quoteSelectedText(annotation.selectedText)}\n\n${annotation.comment}`,
    )
    .join("\n\n---\n\n");

  return `I have comments on earlier assistant responses. Address every comment below.\n\n${comments}`;
}
