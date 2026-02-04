import type React from "react";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadFilePath,
} from "./DyadCardPrimitives";

interface DyadReadProps {
  children?: ReactNode;
  node?: any;
  path?: string;
}

export const DyadRead: React.FC<DyadReadProps> = ({ node, path: pathProp }) => {
  const path = pathProp || node?.properties?.path || "";
  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard accentColor="slate">
      <DyadCardHeader icon={<FileText size={15} />} accentColor="slate">
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        <DyadBadge color="slate">Read</DyadBadge>
      </DyadCardHeader>
      <DyadFilePath path={path} />
    </DyadCard>
  );
};
