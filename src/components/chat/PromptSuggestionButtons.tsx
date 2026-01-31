import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PromptSuggestion } from "@/lib/schemas";

interface PromptSuggestionButtonsProps {
  suggestions: PromptSuggestion[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export function PromptSuggestionButtons({
  suggestions,
  onSelect,
  disabled = false,
}: PromptSuggestionButtonsProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto px-2 pt-2 pb-2"
      data-testid="prompt-suggestion-buttons"
    >
      <TooltipProvider>
        {suggestions.map((suggestion) => (
          <Tooltip key={suggestion.prompt}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onSelect(suggestion.prompt)}
                className="shrink-0 max-w-[180px]"
                data-testid="prompt-suggestion-button"
              >
                <span className="overflow-hidden whitespace-nowrap text-ellipsis">
                  {suggestion.summary}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent
              className="max-w-md whitespace-pre-wrap text-left"
              side="top"
            >
              {suggestion.prompt}
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </div>
  );
}
