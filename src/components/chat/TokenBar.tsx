import React from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCountTokens } from "@/hooks/useCountTokens";
import {
  MessageSquare,
  Code,
  Bot,
  AlignLeft,
  ExternalLink,
} from "lucide-react";
import { chatInputValueAtom } from "@/atoms/chatAtoms";
import { useAtom } from "jotai";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";

interface TokenBarProps {
  chatId?: number;
}

export function TokenBar({ chatId }: TokenBarProps) {
  const { t } = useTranslation("chat");
  const [inputValue] = useAtom(chatInputValueAtom);
  const { settings } = useSettings();
  const { result, error } = useCountTokens(chatId ?? null, inputValue);

  if (!chatId || !result) {
    return null;
  }

  const {
    estimatedTotalTokens: totalTokens,
    messageHistoryTokens,
    codebaseTokens,
    mentionedAppsTokens,
    systemPromptTokens,
    inputTokens,
    contextWindow,
  } = result;

  const percentUsed = Math.min((totalTokens / contextWindow) * 100, 100);

  // Calculate widths for each token type
  const messageHistoryPercent = (messageHistoryTokens / contextWindow) * 100;
  const codebasePercent = (codebaseTokens / contextWindow) * 100;
  const mentionedAppsPercent = (mentionedAppsTokens / contextWindow) * 100;
  const systemPromptPercent = (systemPromptTokens / contextWindow) * 100;
  const inputPercent = (inputTokens / contextWindow) * 100;

  return (
    <div className="px-4 pb-2 text-xs" data-testid="token-bar">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="w-full">
            <div className="w-full">
              <div className="flex gap-3 mb-1 text-xs text-muted-foreground">
                <span>
                  {t("tokenUsage", { value: totalTokens.toLocaleString() })}
                </span>
                <span>{Math.round(percentUsed)}%</span>
                <span>
                  {t("contextWindow", {
                    value: (contextWindow / 1000).toFixed(0),
                  })}
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden flex">
                {/* Message history tokens */}
                <div
                  className="h-full bg-blue-400"
                  style={{ width: `${messageHistoryPercent}%` }}
                />
                {/* Codebase tokens */}
                <div
                  className="h-full bg-green-400"
                  style={{ width: `${codebasePercent}%` }}
                />
                {/* Mentioned apps tokens */}
                <div
                  className="h-full bg-orange-400"
                  style={{ width: `${mentionedAppsPercent}%` }}
                />
                {/* System prompt tokens */}
                <div
                  className="h-full bg-purple-400"
                  style={{ width: `${systemPromptPercent}%` }}
                />
                {/* Input tokens */}
                <div
                  className="h-full bg-yellow-400"
                  style={{ width: `${inputPercent}%` }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="w-64 p-2">
            <div className="space-y-1">
              <div className="font-medium">{t("tokenUsageBreakdown")}</div>
              <div className="grid grid-cols-[20px_1fr_auto] gap-x-2 items-center">
                <MessageSquare size={12} className="text-blue-500" />
                <span>{t("messageHistory")}</span>
                <span>{messageHistoryTokens.toLocaleString()}</span>

                <Code size={12} className="text-green-500" />
                <span>{t("codebase")}</span>
                <span>{codebaseTokens.toLocaleString()}</span>

                <ExternalLink size={12} className="text-orange-500" />
                <span>{t("mentionedApps")}</span>
                <span>{mentionedAppsTokens.toLocaleString()}</span>

                <Bot size={12} className="text-purple-500" />
                <span>{t("systemPrompt")}</span>
                <span>{systemPromptTokens.toLocaleString()}</span>

                <AlignLeft size={12} className="text-yellow-500" />
                <span>{t("currentInput")}</span>
                <span>{inputTokens.toLocaleString()}</span>
              </div>
              <div className="pt-1 border-t border-border">
                <div className="flex justify-between font-medium">
                  <span>{t("total")}</span>
                  <span>{totalTokens.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {error && (
        <div className="text-red-500 text-xs mt-1">
          {t("failedCountTokens")}
        </div>
      )}
      {(!settings?.enableProSmartFilesContextMode ||
        !settings?.enableDyadPro) && (
        <div className="text-xs text-center text-muted-foreground mt-2">
          {t("optimizeTokens")}{" "}
          <a
            onClick={() =>
              settings?.enableDyadPro
                ? ipc.system.openExternalUrl(
                    "https://www.dyad.sh/docs/guides/ai-models/pro-modes#smart-context",
                  )
                : ipc.system.openExternalUrl("https://dyad.sh/pro#ai")
            }
            className="text-blue-500 dark:text-blue-400 cursor-pointer hover:underline"
          >
            {t("dyadProSmartContext")}
          </a>
        </div>
      )}
    </div>
  );
}
