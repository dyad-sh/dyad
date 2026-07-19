import type React from "react";
import type { ReactNode } from "react";
import { ScanQrCode } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { useTranslation } from "react-i18next";

interface DyadWebCrawlProps {
  children?: ReactNode;
  node?: any;
}

export const DyadWebCrawl: React.FC<DyadWebCrawlProps> = ({
  children,
  node: _node,
}) => {
  const { t } = useTranslation("chat");
  return (
    <DyadCard accentColor="blue">
      <DyadCardHeader icon={<ScanQrCode size={15} />} accentColor="blue">
        <DyadBadge color="blue">{t("webCrawl")}</DyadBadge>
      </DyadCardHeader>
      {children && (
        <div className="px-3 pb-2 text-sm italic text-muted-foreground">
          {children}
        </div>
      )}
    </DyadCard>
  );
};
