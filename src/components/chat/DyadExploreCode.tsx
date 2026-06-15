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
      ? `${files || "0"} file${files === "1" ? "" : "s"}, ${symbols || "0"} symbol${symbols === "1" ? "" : "s"}`
      : "";
  const timing =
    indexMs || searchMs
      ? `${indexMs || "0"}ms index, ${searchMs || "0"}ms search`
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
        <DyadBadge color="teal">CODE</DyadBadge>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        <span className="font-medium text-sm text-foreground truncate">
          {query ? `"${query}"` : "Explore code"}
        </span>
        {resultSummary && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({resultSummary}
            {truncated ? ", truncated" : ""})
          </span>
        )}
        {timing && (
          <span className="text-xs text-muted-foreground shrink-0">
            {timing}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Exploring..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        {errored && <DyadStateIndicator state="error" errorLabel="Failed" />}
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
