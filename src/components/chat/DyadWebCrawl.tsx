import type React from "react";
import type { ReactNode } from "react";
import { ScanQrCode } from "lucide-react";

interface DyadWebCrawlProps {
  children?: ReactNode;
  node?: any;
}

export const DyadWebCrawl: React.FC<DyadWebCrawlProps> = ({
  children,
  node: _node,
}) => {
  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanQrCode size={16} className="text-blue-600" />
          <div className="text-xs text-blue-600 font-medium">Web Crawl</div>
        </div>
      </div>
      <div className="text-sm italic text-gray-600 dark:text-gray-300 mt-2">
        {children}
      </div>
    </div>
  );
};
