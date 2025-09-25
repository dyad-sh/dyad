import type React from "react";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";

interface DyadReadProps {
  children?: ReactNode;
  node?: any;
  path?: string;
}

export const DyadRead: React.FC<DyadReadProps> = ({
  children,
  node,
  path: pathProp,
}) => {
  const path = pathProp || node?.properties?.path || "";
  const fileName = path ? path.split("/").pop() : "";

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border border-border my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gray-600" />
          {fileName && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {fileName}
            </span>
          )}
          <div className="text-xs text-gray-600 font-medium">Read</div>
        </div>
      </div>
      {path && (
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
          {path}
        </div>
      )}
      {children && (
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-2">
          {children}
        </div>
      )}
    </div>
  );
};
