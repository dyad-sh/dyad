import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { BookOpen } from "lucide-react";
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

interface DyadReadChatProps {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      chatId?: string;
      title?: string;
      range?: string;
    };
  };
}

export const DyadReadChat: React.FC<DyadReadChatProps> = ({
  children,
  node,
}) => {
  const { t } = useTranslation("chat");
  const [isContentVisible, setIsContentVisible] = useState(false);

  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const chatId = node?.properties?.chatId || "";
  const title = node?.properties?.title || "";
  const range = node?.properties?.range || "";

  return (
    <DyadCard
      state={state}
      accentColor="violet"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
      data-testid="dyad-read-chat"
    >
      <DyadCardHeader icon={<BookOpen size={15} />} accentColor="violet">
        <DyadBadge color="violet">{t("readChatTool.badge")}</DyadBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {title || t("readChatTool.chatNumber", { chatId })}
        </span>
        {range && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({t("readChatTool.messagesRange", { range })})
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator
            state="pending"
            pendingLabel={t("readChatTool.reading")}
          />
        )}
        {aborted && (
          <DyadStateIndicator
            state="aborted"
            abortedLabel={t("readChatTool.didNotFinish")}
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
