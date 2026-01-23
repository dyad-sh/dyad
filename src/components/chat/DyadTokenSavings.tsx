import React from "react";
import { Zap } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";

interface DyadTokenSavingsProps {
  originalTokens: number;
  smartContextTokens: number;
}

export const DyadTokenSavings: React.FC<DyadTokenSavingsProps> = ({
  originalTokens,
  smartContextTokens,
}) => {
  const tokensSaved = originalTokens - smartContextTokens;
  const percentageSaved = Math.round((tokensSaved / originalTokens) * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900 rounded-lg px-4 py-2 border border-green-200 dark:border-green-800 my-2 cursor-pointer">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Zap size={16} className="text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium">
              Saved {percentageSaved}% of codebase tokens with Smart Context
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <div className="text-left">
          Saved {Math.round(tokensSaved).toLocaleString()} tokens
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
