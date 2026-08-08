export function replacePromptReference(
  userPrompt: string,
  promptsById: Record<number | string, string>,
): string {
  if (typeof userPrompt !== "string" || userPrompt.length === 0)
    return userPrompt;

  return userPrompt.replace(
    /@prompt:(\d+)/g,
    (_match: string, idStr: string) => {
      const idNum = Number(idStr);
      const replacement = promptsById[idNum] ?? promptsById[idStr];
      return replacement !== undefined ? replacement : _match;
    },
  );
}
