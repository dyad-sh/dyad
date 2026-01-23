import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSummarizeInNewChat } from "./SummarizeInNewChatButton";

const CONTEXT_LIMIT_THRESHOLD = 40_000;

interface ContextLimitBannerProps {
  totalTokens?: number | null;
  contextWindow?: number;
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`.replace(".0k", "k");
  }
  return count.toString();
}

export function ContextLimitBanner({
  totalTokens,
  contextWindow,
}: ContextLimitBannerProps) {
  const { handleSummarize } = useSummarizeInNewChat();

  // Don't show banner if we don't have the necessary data
  if (!totalTokens || !contextWindow) {
    return null;
  }

  // Check if we're within 40k tokens of the context limit
  const tokensRemaining = contextWindow - totalTokens;
  if (tokensRemaining > CONTEXT_LIMIT_THRESHOLD) {
    return null;
  }

  return (
    <div
      className="mx-auto max-w-3xl my-3 p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2"
      data-testid="context-limit-banner"
    >
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0 hover:bg-transparent text-amber-600 dark:text-amber-400 cursor-help"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="w-auto p-2 text-xs" side="top">
            <div className="grid gap-1">
              <div className="flex justify-between gap-4">
                <span>Used:</span>
                <span className="font-medium">
                  {formatTokenCount(totalTokens)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Limit:</span>
                <span className="font-medium">
                  {formatTokenCount(contextWindow)}
                </span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <p className="text-sm font-medium">
          You're close to the context limit for this chat.
        </p>
      </div>
      <Button
        onClick={handleSummarize}
        variant="outline"
        size="sm"
        className="h-8 border-amber-500/50 hover:bg-amber-500/20 hover:border-amber-500 text-amber-600 dark:text-amber-400"
      >
        Summarize into new chat
        <ArrowRight className="h-3 w-3 ml-2" />
      </Button>
    </div>
  );
}
