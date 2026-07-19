import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadExploreCodeProps {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      query?: string;
      appName?: string;
      files?: string;
      symbols?: string;
      indexMs?: string;
      searchMs?: string;
      truncated?: string;
    };
  };
}

export const DyadExploreCode: React.FC<DyadExploreCodeProps> = ({
  children,
  node,
}) => {
  const { t } = useTranslation("chat");
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isContentVisible, setIsContentVisible] = useState(inProgress);

  useEffect(() => {
    if (!inProgress && isContentVisible) {
      setIsContentVisible(false);
    }
  }, [inProgress]);
  const aborted = state === "aborted";
  const errored = state === "error";
  const query = node?.properties?.query || "";
  const appName = node?.properties?.appName || "";
  const files = node?.properties?.files || "";
  const symbols = node?.properties?.symbols || "";
  const indexMs = node?.properties?.indexMs || "";
  const searchMs = node?.properties?.searchMs || "";
  const truncated = node?.properties?.truncated === "true";

  const resultSummary =
    files || symbols
      ? t("exploreSummary", {
          files: files || "0",
          symbols: symbols || "0",
        })
      : "";
  const timing =
    indexMs || searchMs
      ? t("searchTiming", {
          index: indexMs || "0",
          search: searchMs || "0",
        })
      : "";

  return (
    <DyadCard
      state={state}
      accentColor="teal"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
      data-testid="dyad-explore-code"
    >
      <DyadCardHeader icon={<ScanSearch size={15} />} accentColor="teal">
        <DyadBadge color="teal">{t("code")}</DyadBadge>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        <span className="font-medium text-sm text-foreground truncate">
          {query ? `"${query}"` : t("exploreCode")}
        </span>
        {resultSummary && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({resultSummary}
            {truncated ? `, ${t("truncated")}` : ""})
          </span>
        )}
        {timing && (
          <span className="text-xs text-muted-foreground shrink-0">
            {timing}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel={t("exploring")} />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel={t("didNotFinish")} />
        )}
        {errored && <DyadStateIndicator state="error" errorLabel={t("failed")} />}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs" onClick={(e) => e.stopPropagation()}>
          <CodeHighlight className="language-markdown">
            {children}
          </CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
