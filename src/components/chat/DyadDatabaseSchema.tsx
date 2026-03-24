import React from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIStateIndicator,
} from "./ProteaAICardPrimitives";

interface ProteaAIDatabaseSchemaProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ProteaAIDatabaseSchema({
  node,
  children,
}: ProteaAIDatabaseSchemaProps) {
  const { state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <ProteaAICard state={state} accentColor="teal">
      <ProteaAICardHeader icon={<Database size={15} />} accentColor="teal">
        <ProteaAIBadge color="teal">Database Schema</ProteaAIBadge>
        {isLoading && <ProteaAIStateIndicator state="pending" />}
      </ProteaAICardHeader>
      {content && (
        <div className="px-3 pb-3">
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        </div>
      )}
    </ProteaAICard>
  );
}
