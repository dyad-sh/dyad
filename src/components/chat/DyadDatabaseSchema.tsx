import React from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadDatabaseSchemaProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadDatabaseSchema({
  node,
  children,
}: DyadDatabaseSchemaProps) {
  const { t } = useTranslation("chat");
  const { state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <DyadCard state={state} accentColor="teal">
      <DyadCardHeader icon={<Database size={15} />} accentColor="teal">
        <DyadBadge color="teal">{t("databaseSchema")}</DyadBadge>
        {isLoading && <DyadStateIndicator state="pending" />}
      </DyadCardHeader>
      {content && (
        <div className="px-3 pb-3">
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        </div>
      )}
    </DyadCard>
  );
}
