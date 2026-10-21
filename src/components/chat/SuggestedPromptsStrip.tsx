import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { dismissedSuggestedPromptsByChatIdAtom } from "@/atoms/suggestedPromptsAtoms";

interface SuggestedPromptsStripProps {
  chatId: number;
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
  chatId,
  messageId,
  prompts,
  onSelect,
}: SuggestedPromptsStripProps) {
  const { t } = useTranslation("chat");
  const [dismissedByChatId, setDismissedByChatId] = useAtom(
    dismissedSuggestedPromptsByChatIdAtom,
  );

  if (prompts.length === 0 || dismissedByChatId.get(chatId) === messageId)
    return null;

  return (
    <div
      className="px-2 pt-2 flex flex-wrap items-center gap-1.5"
      data-testid="suggested-prompts"
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground mr-0.5">
        <Lightbulb size={12} aria-hidden="true" />
        {t("suggestedPrompts.label")}
      </span>
      {prompts.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-full rounded-full px-3 text-xs font-normal"
          title={prompt}
          onClick={() => onSelect(prompt)}
        >
          <span className="truncate">{prompt}</span>
        </Button>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() =>
                setDismissedByChatId((prev) =>
                  new Map(prev).set(chatId, messageId),
                )
              }
              aria-label={t("suggestedPrompts.dismiss")}
              className="ml-auto hover:bg-muted-foreground/20 rounded-full p-1 text-muted-foreground cursor-pointer"
            />
          }
        >
          <X size={12} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{t("suggestedPrompts.dismiss")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
