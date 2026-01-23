import type React from "react";
import type { ReactNode } from "react";
import { FileEdit } from "lucide-react";

interface DyadRenameProps {
  children?: ReactNode;
  node?: any;
  from?: string;
  to?: string;
}

export const DyadRename: React.FC<DyadRenameProps> = ({
  children,
  node,
  from: fromProp,
  to: toProp,
}) => {
  // Use props directly if provided, otherwise extract from node
  const from = fromProp || node?.properties?.from || "";
  const to = toProp || node?.properties?.to || "";

  // Extract filenames from paths
  const fromFileName = from ? from.split("/").pop() : "";
  const toFileName = to ? to.split("/").pop() : "";

  return (
    <div className="bg-(--background-lightest) rounded-lg px-4 py-2 border border-amber-500 my-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileEdit size={16} className="text-amber-500" />
          {(fromFileName || toFileName) && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {fromFileName && toFileName
                ? `${fromFileName} → ${toFileName}`
                : fromFileName || toFileName}
            </span>
          )}
          <div className="text-xs text-amber-500 font-medium">Rename</div>
        </div>
      </div>
      {(from || to) && (
        <div className="flex flex-col text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
          {from && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">From:</span>{" "}
              {from}
            </div>
          )}
          {to && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">To:</span> {to}
            </div>
          )}
        </div>
      )}
      <div className="text-sm text-gray-600 dark:text-gray-300 mt-2">
        {children}
      </div>
    </div>
  );
};
