import type React from "react";
import type { ReactNode } from "react";
import { Rabbit } from "lucide-react";

interface DyadWebCrawlProps {
  children?: ReactNode;
  node?: any;
  query?: string;
}

export const DyadWebCrawl: React.FC<DyadWebCrawlProps> = ({
  children,
  node: _node,
  query: queryProp,
}) => {
  const query = queryProp || (typeof children === "string" ? children : "");

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rabbit size={16} className="text-blue-600" />
          <div className="text-xs text-blue-600 font-medium">Web Crawl</div>
        </div>
      </div>
      <div className="text-sm italic text-gray-600 dark:text-gray-300 mt-2">
        {query || children}
      </div>
    </div>
  );
};
