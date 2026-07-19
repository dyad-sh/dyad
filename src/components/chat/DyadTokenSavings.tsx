import React from "react";
import { Zap } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { DyadCard, DyadCardHeader } from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadTokenSavingsProps {
  originalTokens: number;
  smartContextTokens: number;
}

export const DyadTokenSavings: React.FC<DyadTokenSavingsProps> = ({
  originalTokens,
  smartContextTokens,
}) => {
  const { t } = useTranslation("chat");
  const tokensSaved = originalTokens - smartContextTokens;
  const percentageSaved =
    originalTokens > 0 ? Math.round((tokensSaved / originalTokens) * 100) : 0;

  return (
    <Tooltip>
      <TooltipTrigger>
        <DyadCard accentColor="green">
          <DyadCardHeader icon={<Zap size={15} />} accentColor="green">
            <span className="text-xs font-medium text-green-700 dark:text-green-300">
              {t("savedCodebaseTokens", { percent: percentageSaved })}
            </span>
          </DyadCardHeader>
        </DyadCard>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <div className="text-left">
          {t("savedTokens", {
            count: Math.round(tokensSaved).toLocaleString(),
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
