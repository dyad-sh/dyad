import React from "react";
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
import { chatInputValueAtom, chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";

interface TokenBarProps {
  chatId?: number;
}

export function TokenBar({ chatId }: TokenBarProps) {
  const { data: chat } = useQuery({
    queryKey: queryKeys.chats.detail({ chatId: chatId ?? null }),
    queryFn: () => ipc.chat.getChat(chatId!),
    enabled: chatId != null,
  });
  const messages =
    useAtomValue(chatMessagesByIdAtom).get(chatId ?? -1) ??
    chat?.messages ??
    [];
  if (chat?.executionBackend === "claude-code") {
    const latest = messages
      .filter((message) => message.role === "assistant")
      .at(-1);
    return <SubscriptionUsage receipt={latest?.executionUsage} />;
  }
  return <DyadTokenBar chatId={chatId} />;
}

export function SubscriptionUsage({ receipt }: { receipt?: string | null }) {
  let status: string | undefined;
  try {
    status = JSON.parse(receipt ?? "null")?.status;
  } catch {
    /* unavailable */
  }
  return (
    <div
      className="px-4 pb-2 text-xs text-muted-foreground space-y-1"
      data-testid="subscription-usage"
    >
      <div>
        {status === "unbilled"
          ? "Pro was off for this turn: no Dyad credits charged."
          : status === "attempted"
            ? "Usage reporting attempted. See your billing account for actual spend."
            : "Usage unavailable. No token count or charge has been inferred."}
      </div>
      <div>
        Claude subscription usage applies. With Pro enabled, Dyad charges $0.02
        per million total tokens for model IDs containing -luna, -mini or -nano;
        $0.10 per million otherwise. Cached tokens count once. Reporting is best
        effort, without retries.
      </div>
      <div>
        CLI context is managed separately; Dyad's context estimate is not a
        billing measurement.
      </div>
    </div>
  );
}

function DyadTokenBar({ chatId }: TokenBarProps) {
  const [inputValue] = useAtom(chatInputValueAtom);
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
                <span>Tokens: {totalTokens.toLocaleString()}</span>
                <span>{Math.round(percentUsed)}%</span>
                <span>
                  Context window: {(contextWindow / 1000).toFixed(0)}K
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
              <div className="font-medium">Token Usage Breakdown</div>
              <div className="grid grid-cols-[20px_1fr_auto] gap-x-2 items-center">
                <MessageSquare size={12} className="text-blue-500" />
                <span>Message History</span>
                <span>{messageHistoryTokens.toLocaleString()}</span>

                <Code size={12} className="text-green-500" />
                <span>Codebase</span>
                <span>{codebaseTokens.toLocaleString()}</span>

                <ExternalLink size={12} className="text-orange-500" />
                <span>Mentioned Apps</span>
                <span>{mentionedAppsTokens.toLocaleString()}</span>

                <Bot size={12} className="text-purple-500" />
                <span>System Prompt</span>
                <span>{systemPromptTokens.toLocaleString()}</span>

                <AlignLeft size={12} className="text-yellow-500" />
                <span>Current Input</span>
                <span>{inputTokens.toLocaleString()}</span>
              </div>
              <div className="pt-1 border-t border-border">
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span>{totalTokens.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {error && (
        <div className="text-red-500 text-xs mt-1">Failed to count tokens</div>
      )}
    </div>
  );
}
