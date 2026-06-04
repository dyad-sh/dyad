import type React from "react";
import type { ReactNode } from "react";
import { Children, useMemo, useState } from "react";
import { AlertTriangle, Database } from "lucide-react";
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
import { doesSqlMutateSchema } from "@/lib/sqlSchemaMutation";

interface DyadExecuteSqlProps {
  children?: ReactNode;
  node?: any;
  description?: string;
}

function extractSqlText(children: ReactNode): string {
  if (typeof children === "string") return children;
  return Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");
}

export const DyadExecuteSql: React.FC<DyadExecuteSqlProps> = ({
  children,
  node,
  description,
}) => {
  const { t } = useTranslation("chat");
  const [isContentVisible, setIsContentVisible] = useState(false);
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";
  const queryDescription = description || node?.properties?.description;
  const sqlText = extractSqlText(children);
  const sqlMutatesSchema = useMemo(
    () => (sqlText ? doesSqlMutateSchema(sqlText) : false),
    [sqlText],
  );

  return (
    <DyadCard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <DyadCardHeader icon={<Database size={15} />} accentColor="teal">
        <DyadBadge color="teal">SQL</DyadBadge>
        {sqlMutatesSchema && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {t("changesDatabaseSchema")}
          </span>
        )}
        {queryDescription && (
          <span className="font-medium text-sm text-foreground truncate">
            {queryDescription}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Executing..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs">
          <CodeHighlight className="language-sql">{children}</CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
