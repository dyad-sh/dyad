import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { Database } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeySupabaseProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ConeySupabaseProjectInfo({
  node,
  children,
}: ConeySupabaseProjectInfoProps) {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const { state } = node.properties;
  const isLoading = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";

  return (
    <ConeyCard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ConeyCardHeader icon={<Database size={15} />} accentColor="teal">
        <ConeyBadge color="teal">Supabase Project Info</ConeyBadge>
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
