import type React from "react";
import type { ReactNode } from "react";
import { Globe } from "lucide-react";

interface DyadWebSearchProps {
  children?: ReactNode;
  node?: any;
  query?: string;
}

export const DyadWebSearch: React.FC<DyadWebSearchProps> = ({
  children,
  node: _node,
  query: queryProp,
}) => {
  const query = queryProp || (typeof children === "string" ? children : "");

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-blue-600" />
          <div className="text-xs text-blue-600 font-medium">Web Search</div>
        </div>
      </div>
      <div className="text-sm italic text-gray-600 dark:text-gray-300 mt-2">
        {query || children}
      </div>
    </div>
  );
};
