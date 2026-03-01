import type React from "react";
import type { ReactNode } from "react";
import { ScanQrCode } from "lucide-react";
import { ConeyCard, ConeyCardHeader, ConeyBadge } from "./ConeyCardPrimitives";

interface ConeyWebCrawlProps {
  children?: ReactNode;
  node?: any;
}

export const ConeyWebCrawl: React.FC<ConeyWebCrawlProps> = ({
  children,
  node: _node,
}) => {
  return (
    <ConeyCard accentColor="blue">
      <ConeyCardHeader icon={<ScanQrCode size={15} />} accentColor="blue">
        <ConeyBadge color="blue">Web Crawl</ConeyBadge>
      </ConeyCardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </ConeyCard>
  );
};
