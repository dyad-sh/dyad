import React from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyStateIndicator,
} from "./ConeyCardPrimitives";

interface ConeyDatabaseSchemaProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ConeyDatabaseSchema({
  node,
  children,
}: ConeyDatabaseSchemaProps) {
  const { state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <ConeyCard state={state} accentColor="teal">
      <ConeyCardHeader icon={<Database size={15} />} accentColor="teal">
        <ConeyBadge color="teal">Database Schema</ConeyBadge>
        {isLoading && <ConeyStateIndicator state="pending" />}
      </ConeyCardHeader>
      {content && (
        <div className="px-3 pb-3">
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        </div>
      )}
    </ConeyCard>
  );
}
