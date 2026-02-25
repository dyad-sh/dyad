import type React from "react";
import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";

interface DyadWebFetchProps {
  children?: ReactNode;
  node?: any;
}

export const DyadWebFetch: React.FC<DyadWebFetchProps> = ({
  children,
  node: _node,
}) => {
  return (
    <DyadCard accentColor="blue">
      <DyadCardHeader icon={<Globe size={15} />} accentColor="blue">
        <DyadBadge color="blue">Web Fetch</DyadBadge>
      </DyadCardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </DyadCard>
  );
};
