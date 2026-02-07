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
  const dirPath = path
    ? path.slice(0, path.length - (fileName?.length || 0))
    : "";

  return (
    <div className="my-1">
      <div className="flex items-center gap-1 py-1">
        <FileText size={14} className="shrink-0 text-muted-foreground/50" />
        <span className="text-[13px] font-medium text-foreground/70">Read</span>
        {path && (
          <span className="text-[13px] truncate min-w-0" title={path}>
            {dirPath && (
              <span className="text-muted-foreground/85">{dirPath}</span>
            )}
            <span className="font-medium text-foreground/70">{fileName}</span>
          </span>
        )}
      </div>
      {children && (
        <div className="text-xs text-muted-foreground ml-5">{children}</div>
      )}
    </div>
  );
};
