import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIExpandIcon,
  ProteaAIStateIndicator,
  ProteaAICardContent,
} from "./ProteaAICardPrimitives";

interface ProteaAISupabaseProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ProteaAISupabaseProjectInfo({
  node,
  children,
}: ProteaAISupabaseProjectInfoProps) {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const { state } = node.properties;
  const isLoading = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";

  return (
    <ProteaAICard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ProteaAICardHeader icon={<Database size={15} />} accentColor="teal">
        <ProteaAIBadge color="teal">Supabase Project Info</ProteaAIBadge>
        {isLoading && (
          <ProteaAIStateIndicator state="pending" pendingLabel="Fetching..." />
        )}
        {isAborted && (
          <ProteaAIStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <ProteaAIExpandIcon isExpanded={isContentVisible} />
        </div>
      </ProteaAICardHeader>
      <ProteaAICardContent isExpanded={isContentVisible}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-80 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </ProteaAICardContent>
    </ProteaAICard>
  );
}
