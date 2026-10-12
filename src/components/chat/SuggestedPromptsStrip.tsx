import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuggestedPromptsStripProps {
  /** Assistant message the prompts came from; dismissal is scoped to it. */
  messageId: number;
  prompts: string[];
  onSelect: (prompt: string) => void;
}

/**
 * Clickable follow-up prompts the model suggested at the end of its last
 * turn, shown above the chat input so a user who is unsure what to ask next
 * can keep iterating with one click.
 */
export function SuggestedPromptsStrip({
  messageId,
  prompts,
  onSelect,
}: SuggestedPromptsStripProps) {
  const { t } = useTranslation("chat");
  const [dismissedMessageId, setDismissedMessageId] = useState<number | null>(
    null,
  );

  if (prompts.length === 0 || dismissedMessageId === messageId) return null;

  return (
    <div
      className="px-2 pt-2 flex flex-wrap items-center gap-1.5"
      data-testid="suggested-prompts"
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground mr-0.5">
        <Sparkles size={12} aria-hidden="true" />
        {t("suggestedPrompts.label")}
      </span>
      {prompts.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-full px-3 text-xs font-normal whitespace-normal text-left"
          onClick={() => onSelect(prompt)}
        >
          {prompt}
        </Button>
      ))}
      <button
        type="button"
        onClick={() => setDismissedMessageId(messageId)}
        aria-label={t("suggestedPrompts.dismiss")}
        title={t("suggestedPrompts.dismiss")}
        className="ml-auto hover:bg-muted-foreground/20 rounded-full p-1 text-muted-foreground cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}
