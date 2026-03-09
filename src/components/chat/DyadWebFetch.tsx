import type { FC, ReactNode } from "react";
import { Globe } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface DyadWebFetchProps {
  children?: ReactNode;
  node?: {
    properties: {
      state?: CustomTagState;
    };
  };
}

export const DyadWebFetch: FC<DyadWebFetchProps> = ({ children, node }) => {
  const state = node?.properties?.state as CustomTagState;

  return (
    <DyadCard state={state} accentColor="blue">
      <DyadCardHeader icon={<Globe size={15} />} accentColor="blue">
        <DyadBadge color="blue">Web Fetch</DyadBadge>
        {state && (
          <DyadStateIndicator
            state={state}
            pendingLabel="Fetching..."
            finishedLabel="Done"
            abortedLabel="Aborted"
          />
        )}
      </DyadCardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </DyadCard>
  );
};
