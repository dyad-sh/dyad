import type { FC, ReactNode } from "react";
import { Globe } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIStateIndicator,
} from "./ProteaAICardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ProteaAIWebFetchProps {
  children?: ReactNode;
  node?: {
    properties: {
      state?: CustomTagState;
    };
  };
}

export const ProteaAIWebFetch: FC<ProteaAIWebFetchProps> = ({ children, node }) => {
  const state = node?.properties?.state as CustomTagState;

  return (
    <ProteaAICard state={state} accentColor="blue">
      <ProteaAICardHeader icon={<Globe size={15} />} accentColor="blue">
        <ProteaAIBadge color="blue">Web Fetch</ProteaAIBadge>
        {state && (
          <ProteaAIStateIndicator
            state={state}
            pendingLabel="Fetching..."
            finishedLabel="Done"
            abortedLabel="Aborted"
          />
        )}
      </ProteaAICardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </ProteaAICard>
  );
};
