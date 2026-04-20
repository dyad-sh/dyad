import React from "react";
import { Server } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";

export const DyadEnableNitro: React.FC = () => {
  return (
    <DyadCard accentColor="emerald">
      <DyadCardHeader icon={<Server size={15} />} accentColor="emerald">
        <DyadBadge color="emerald">Server layer</DyadBadge>
        <span className="text-sm font-medium text-foreground">
          Added Nitro server layer
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3">
        <p className="text-xs text-muted-foreground leading-snug">
          API routes can now live under{" "}
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted">
            server/routes/api/
          </code>
          . Secrets and database clients must stay on the server.
        </p>
      </div>
    </DyadCard>
  );
};
