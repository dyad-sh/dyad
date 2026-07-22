import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
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

interface DyadSearchChatsProps {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      query?: string;
      indexStatus?: string;
      resultCount?: string;
    };
  };
}

export const DyadSearchChats: React.FC<DyadSearchChatsProps> = ({
  children,
  node,
}) => {
  const { t } = useTranslation("chat");
  const [isContentVisible, setIsContentVisible] = useState(false);

  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const query = node?.properties?.query || "";
  const indexStatus = node?.properties?.indexStatus || "";
  const resultCount = node?.properties?.resultCount;

  return (
    <DyadCard
      state={state}
      accentColor="violet"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
      data-testid="dyad-search-chats"
    >
      <DyadCardHeader icon={<MessagesSquare size={15} />} accentColor="violet">
        <DyadBadge color="violet">{t("searchChatsTool.badge")}</DyadBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {`"${query}"`}
        </span>
        {resultCount !== undefined && !inProgress && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({t("searchChatsTool.chatCount", { count: Number(resultCount) })})
          </span>
        )}
        {indexStatus === "indexing" && (
          <span className="text-xs text-muted-foreground shrink-0">
            {t("searchChatsTool.stillIndexing")}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator
            state="pending"
            pendingLabel={t("searchChatsTool.searching")}
          />
        )}
        {aborted && (
          <DyadStateIndicator
            state="aborted"
            abortedLabel={t("searchChatsTool.didNotFinish")}
          />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs" onClick={(e) => e.stopPropagation()}>
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
