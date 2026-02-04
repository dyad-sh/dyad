import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadSupabaseProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadSupabaseProjectInfo({
  node,
  children,
}: DyadSupabaseProjectInfoProps) {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const { state } = node.properties;
  const isLoading = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";

  return (
    <DyadCard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <DyadCardHeader icon={<Database size={15} />} accentColor="teal">
        <DyadBadge color="teal">Supabase Project Info</DyadBadge>
        {isLoading && (
          <DyadStateIndicator state="pending" pendingLabel="Fetching..." />
        )}
        {isAborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-80 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
