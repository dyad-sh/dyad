import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";

// Zero-width space. Invisible in the rendered message and in the model's view
// of the quote, but enough to break the mention/skill patterns below.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * Quoted assistant output is context, not a command.
 *
 * The main process expands `@app:<name>`, `@prompt:<id>`, `@media:<name>` and
 * `/slug` over the whole prompt string before the turn runs, so a response that
 * happened to contain one of those tokens would silently pull in another app's
 * codebase, inline a stored prompt, expand a skill, or resolve a local file
 * just because the user commented on it. Break the trigger so the text stays
 * inert; the user's own comment is left alone so chat syntax they type
 * themselves still works.
 */
function neutralizeChatSyntax(text: string): string {
  return (
    text
      .replace(/@(app|prompt|media)(?=:)/g, `@$1${ZERO_WIDTH_SPACE}`)
      // Mirror `replaceSlashSkillReference`'s pattern exactly: only a whole
      // slug token terminated by whitespace or end-of-string ever expands, so
      // quoted paths like `/usr/bin` must stay byte-for-byte intact.
      .replace(/(^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/g, `$1/${ZERO_WIDTH_SPACE}$2`)
  );
}

function quoteSelectedText(text: string): string {
  return neutralizeChatSyntax(text)
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
