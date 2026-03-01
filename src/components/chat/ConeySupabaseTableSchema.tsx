import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { Table2 } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeySupabaseTableSchemaProps {
  node: {
    properties: {
      table?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ConeySupabaseTableSchema({
  node,
  children,
}: ConeySupabaseTableSchemaProps) {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const { table, state } = node.properties;
  const isLoading = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";

  return (
    <ConeyCard
      state={state}
      accentColor="teal"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
    >
      <ConeyCardHeader icon={<Table2 size={15} />} accentColor="teal">
        <ConeyBadge color="teal">
          {table ? "Table Schema" : "Supabase Table Schema"}
        </ConeyBadge>
        {table && (
          <span className="font-medium text-sm text-foreground truncate">
            {table}
          </span>
        )}
        {isLoading && (
          <ConeyStateIndicator state="pending" pendingLabel="Fetching..." />
        )}
        {isAborted && (
          <ConeyStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isContentVisible} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isContentVisible}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-80 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </ConeyCardContent>
    </ConeyCard>
  );
}
