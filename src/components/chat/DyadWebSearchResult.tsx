import React, { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadWebSearchResultProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadWebSearchResult: React.FC<DyadWebSearchResultProps> = ({
  children,
  node,
}) => {
  const { t } = useTranslation("chat");
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);

  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  return (
    <DyadCard
      state={state}
      accentColor="blue"
      onClick={() => setIsExpanded(!isExpanded)}
      isExpanded={isExpanded}
    >
      <DyadCardHeader icon={<Globe size={15} />} accentColor="blue">
        <DyadBadge color="blue">{t("webSearchResult")}</DyadBadge>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel={t("loading")} />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground">
          {typeof children === "string" ? (
            <VanillaMarkdownParser content={children} />
          ) : (
            children
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
