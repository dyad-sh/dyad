const SUGGESTED_PROMPTS_OPEN = "<dyad-suggested-prompts>";
const SUGGESTED_PROMPTS_CLOSE = "</dyad-suggested-prompts>";
// Two or three short prompts fit far below this. Anything longer is escaped
// instead of being held back from the stream.
const MAX_SUGGESTED_PROMPTS_BLOCK_CHARS = 1000;

/**
 * Whether model text may carry a follow-up suggestions block. The setting must
 * be on, because the system prompt also holds app-controlled text such as
 * AI_RULES.md that could contain the tag.
 */
export function allowsSuggestedPrompts(
  settingEnabled: boolean,
  systemPrompts: readonly string[],
): boolean {
  return (
    settingEnabled &&
    systemPrompts.some((prompt) => prompt.includes(SUGGESTED_PROMPTS_OPEN))
  );
}

/** Keep model-authored Dyad action markup distinct from host-emitted tool cards. */
export function claudeTextFilter(
  allowSecurityFindings = false,
  allowSuggestedPrompts = false,
) {
  let pending = "";
  // A possible suggestions block, held until we know it is safe to pass on.
  let held: string | null = null;

  const escapeTags = (text: string) =>
    text.replace(/<\/?dyad-[\w-]+/gi, (tag) =>
      allowSecurityFindings && /^<\/?dyad-security-finding$/i.test(tag)
        ? tag
        : tag.replace("<", "&lt;"),
    );

  return (text: string, final = false) => {
    pending += text;
    let out = "";

    for (;;) {
      if (held !== null) {
        held += pending;
        pending = "";
        const nextTag = held.indexOf("<", SUGGESTED_PROMPTS_OPEN.length);
        const end = nextTag + SUGGESTED_PROMPTS_CLOSE.length;
        if (
          nextTag >= 0 &&
          held.startsWith(SUGGESTED_PROMPTS_CLOSE, nextTag) &&
          end <= MAX_SUGGESTED_PROMPTS_BLOCK_CHARS
        ) {
          // A short, closed block of plain text cannot hide or fake other
          // markup, so it is the only form that passes through unescaped.
          out += held.slice(0, end);
          pending = held.slice(end);
          held = null;
          continue;
        }
        const waitingForClose =
          !final &&
          held.length <= MAX_SUGGESTED_PROMPTS_BLOCK_CHARS &&
          (nextTag < 0 ||
            SUGGESTED_PROMPTS_CLOSE.startsWith(held.slice(nextTag)));
        if (waitingForClose) return out;
        // Unclosed, too long, or containing other markup: escape the opening
        // tag and handle the rest as ordinary text.
        out += escapeTags(SUGGESTED_PROMPTS_OPEN);
        pending = held.slice(SUGGESTED_PROMPTS_OPEN.length);
        held = null;
        continue;
      }

      const open = allowSuggestedPrompts
        ? pending.indexOf(SUGGESTED_PROMPTS_OPEN)
        : -1;
      if (open >= 0) {
        out += escapeTags(pending.slice(0, open));
        held = pending.slice(open);
        pending = "";
        continue;
      }

      const lastTag = pending.lastIndexOf("<");
      const boundary =
        !final && lastTag >= 0 && /^<\/?[\w-]*$/.test(pending.slice(lastTag))
          ? lastTag
          : pending.length;
      out += escapeTags(pending.slice(0, boundary));
      pending = pending.slice(boundary);
      return out;
    }
  };
}
