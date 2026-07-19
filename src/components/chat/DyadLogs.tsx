import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FileText } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
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

interface DyadLogsProps {
  children?: ReactNode;
  node?: any;
}

export const DyadLogs: React.FC<DyadLogsProps> = ({ children, node }) => {
  const { t } = useTranslation("chat");
  const [isContentVisible, setIsContentVisible] = useState(false);

  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const logCount = node?.properties?.count || "";
  const hasResults = !!logCount;

  const logType = node?.properties?.type || "all";
  const logLevel = node?.properties?.level || "all";
  const filters: string[] = [];
  if (logType !== "all") {
    filters.push(t("logFilterType", { value: logType }));
  }
  if (logLevel !== "all") {
    filters.push(t("logFilterLevel", { value: logLevel }));
  }
  const filterDesc = filters.length > 0 ? ` (${filters.join(", ")})` : "";

  const displayText = t("readingLogs", {
    value: hasResults ? `${logCount} ` : "",
    filters: filterDesc,
  });

  return (
    <DyadCard
      state={state}
      accentColor="slate"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <DyadCardHeader icon={<FileText size={15} />} accentColor="slate">
        <DyadBadge color="slate">{t("logs")}</DyadBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {displayText}
        </span>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel={t("reading")} />
        )}
        {aborted && (
          <DyadStateIndicator
            state="aborted"
            abortedLabel={t("didNotFinish")}
          />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs">
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
