import type React from "react";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";

interface ConeyReadProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  startLine?: string;
  endLine?: string;
}

export const ConeyRead: React.FC<ConeyReadProps> = ({
  children,
  node,
  path: pathProp,
  startLine: startLineProp,
  endLine: endLineProp,
}) => {
  const path = pathProp || node?.properties?.path || "";
  const startLine = startLineProp || node?.properties?.startLine || "";
  const endLine = endLineProp || node?.properties?.endLine || "";
  const fileName = path ? path.split("/").pop() : "";
  const dirPath = path
    ? path.slice(0, path.length - (fileName?.length || 0))
    : "";

  // Build the line number suffix (e.g., ":L3-L5" or ":L3")
  const getLineNumberSuffix = () => {
    if (startLine && endLine) {
      return `:L${startLine}-L${endLine}`;
    } else if (startLine) {
      return `:L${startLine}`;
    } else if (endLine) {
      return `:L1-L${endLine}`;
    }
    return "";
  };
  const lineNumberSuffix = getLineNumberSuffix();

  return (
    <div className="my-1">
      <div className="flex items-center gap-1 py-1">
        <FileText size={14} className="shrink-0 text-muted-foreground/50" />
        <span className="text-[13px] font-medium text-foreground/70">Read</span>
        {path && (
          <span
            className="text-[13px] truncate min-w-0"
            title={path + lineNumberSuffix}
          >
            {dirPath && (
              <span className="text-muted-foreground/85">{dirPath}</span>
            )}
            <span className="font-medium text-foreground/70">{fileName}</span>
            {lineNumberSuffix && (
              <span className="text-muted-foreground/85">
                {lineNumberSuffix}
              </span>
            )}
          </span>
        )}
      </div>
      {children && (
        <div className="text-xs text-muted-foreground ml-5">{children}</div>
      )}
    </div>
  );
};
