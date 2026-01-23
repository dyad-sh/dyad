import type React from "react";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";

interface DyadDeleteProps {
  children?: ReactNode;
  node?: any;
  path?: string;
}

export const DyadDelete: React.FC<DyadDeleteProps> = ({
  children,
  node,
  path: pathProp,
}) => {
  // Use props directly if provided, otherwise extract from node
  const path = pathProp || node?.properties?.path || "";

  // Extract filename from path
  const fileName = path ? path.split("/").pop() : "";

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border border-red-500 my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trash2 size={16} className="text-red-500" />
          {fileName && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {fileName}
            </span>
          )}
          <div className="text-xs text-red-500 font-medium">Delete</div>
        </div>
      </div>
      {path && (
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
          {path}
        </div>
      )}
      <div className="text-sm text-gray-600 dark:text-gray-300 mt-2">
        {children}
      </div>
    </div>
  );
};
