import type React from "react";
import { useState, type ReactNode } from "react";
import { FileCode } from "lucide-react";
import { CustomTagState } from "./stateTypes";
import { useTranslation } from "react-i18next";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadCodeSearchProps {
  children?: ReactNode;
  node?: {
    properties?: { query?: string; state?: CustomTagState; appName?: string };
  };
}

export const DyadCodeSearch: React.FC<DyadCodeSearchProps> = ({
  children,
  node,
}) => {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const query =
    node?.properties?.query || (typeof children === "string" ? children : "");
  const state = node?.properties?.state as CustomTagState;
  const appName = node?.properties?.appName || "";
  const inProgress = state === "pending";

  return (
    <DyadCard
      state={state}
      accentColor="indigo"
      onClick={() => setIsExpanded(!isExpanded)}
      isExpanded={isExpanded}
    >
      <DyadCardHeader icon={<FileCode size={15} />} accentColor="indigo">
        <DyadBadge color="indigo">{t("codeSearch")}</DyadBadge>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        {!isExpanded && query && (
          <span className="text-sm text-muted-foreground italic truncate">
            {query}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel={t("searching")} />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground space-y-2">
          {query && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                {t("query")}
              </span>
              <div className="italic mt-0.5 text-foreground">{query}</div>
            </div>
          )}
          {children && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                {t("results")}
              </span>
              <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-foreground">
                {children}
              </div>
            </div>
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
