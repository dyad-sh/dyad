import type React from "react";
import type { ReactNode } from "react";
import { FileCode } from "lucide-react";

interface DyadCodeSearchProps {
  children?: ReactNode;
  node?: any;
  query?: string;
}

export const DyadCodeSearch: React.FC<DyadCodeSearchProps> = ({
  children,
  node: _node,
  query: queryProp,
}) => {
  const query = queryProp || (typeof children === "string" ? children : "");

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode size={16} className="text-purple-600" />
          <div className="text-xs text-purple-600 font-medium">Code Search</div>
        </div>
      </div>
      <div className="text-sm italic text-gray-600 dark:text-gray-300 mt-2">
        {query || children}
      </div>
    </div>
  );
};
