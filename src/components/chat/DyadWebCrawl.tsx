import type React from "react";
import type { ReactNode } from "react";
import { ScanQrCode } from "lucide-react";
import { ProteaAICard, ProteaAICardHeader, ProteaAIBadge } from "./ProteaAICardPrimitives";

interface ProteaAIWebCrawlProps {
  children?: ReactNode;
  node?: any;
}

export const ProteaAIWebCrawl: React.FC<ProteaAIWebCrawlProps> = ({
  children,
  node: _node,
}) => {
  return (
    <ProteaAICard accentColor="blue">
      <ProteaAICardHeader icon={<ScanQrCode size={15} />} accentColor="blue">
        <ProteaAIBadge color="blue">Web Crawl</ProteaAIBadge>
      </ProteaAICardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </ProteaAICard>
  );
};
