import React from "react";
import { Server } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface DyadEnableNitroProps {
  state?: CustomTagState;
}

export const DyadEnableNitro: React.FC<DyadEnableNitroProps> = ({ state }) => {
  const isPending = state === "pending";
  const isAborted = state === "aborted";
  const headline = isPending
    ? "Adding Nitro server layer"
    : isAborted
      ? "Nitro server layer setup aborted"
      : "Added Nitro server layer";
  return (
    <DyadCard accentColor="emerald" state={state}>
      <DyadCardHeader icon={<Server size={15} />} accentColor="emerald">
        <DyadBadge color="emerald">Server layer</DyadBadge>
        <span className="text-sm font-medium text-foreground">{headline}</span>
        {state && (
          <DyadStateIndicator state={state} abortedLabel="Did not finish" />
        )}
      </DyadCardHeader>
      {!isPending && !isAborted && (
        <div className="px-3 pb-3">
          <p className="text-xs text-muted-foreground leading-snug">
            API routes can now live under{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted">
              server/routes/api/
            </code>
          </p>
        </div>
      )}
    </DyadCard>
  );
};
