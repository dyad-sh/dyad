import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { FolderOpen } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadListFilesProps {
  node: {
    properties: {
      directory?: string;
      recursive?: string;
      include_ignored?: string;
      state?: CustomTagState;
      appName?: string;
    };
  };
  children: React.ReactNode;
}

export function DyadListFiles({ node, children }: DyadListFilesProps) {
  const { t } = useTranslation("chat");
  const { directory, recursive, include_ignored, state, appName } =
    node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const isIncludeIgnored = include_ignored === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);

  const title = directory || t("listFiles");

  return (
    <DyadCard
      state={state}
      accentColor="slate"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="dyad-list-files"
    >
      <DyadCardHeader icon={<FolderOpen size={15} />} accentColor="slate">
        <span className="font-medium text-sm text-foreground truncate">
          {title}
        </span>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        {isRecursive && <DyadBadge color="slate">{t("recursive")}</DyadBadge>}
        {isIncludeIgnored && (
          <DyadBadge color="slate">{t("includeIgnored")}</DyadBadge>
        )}
        {isLoading && (
          <DyadStateIndicator state="pending" pendingLabel={t("listing")} />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
