import type React from "react";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadFilePath,
  DyadDescription,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

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
  const path = pathProp || node?.properties?.path || "";
  const state = node?.properties?.state as CustomTagState;
  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard accentColor="red" state={state}>
      <DyadCardHeader icon={<Trash2 size={15} />} accentColor="red">
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        <DyadBadge color="red">Delete</DyadBadge>
      </DyadCardHeader>
      <DyadFilePath path={path} />
      {children && <DyadDescription>{children}</DyadDescription>}
    </DyadCard>
  );
};
