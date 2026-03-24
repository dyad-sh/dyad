import type React from "react";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIFilePath,
  ProteaAIDescription,
} from "./ProteaAICardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ProteaAIDeleteProps {
  children?: ReactNode;
  node?: any;
  path?: string;
}

export const ProteaAIDelete: React.FC<ProteaAIDeleteProps> = ({
  children,
  node,
  path: pathProp,
}) => {
  const path = pathProp || node?.properties?.path || "";
  const state = node?.properties?.state as CustomTagState;
  const fileName = path ? path.split("/").pop() : "";

  return (
    <ProteaAICard accentColor="red" state={state}>
      <ProteaAICardHeader icon={<Trash2 size={15} />} accentColor="red">
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        <ProteaAIBadge color="red">Delete</ProteaAIBadge>
      </ProteaAICardHeader>
      <ProteaAIFilePath path={path} />
      {children && <ProteaAIDescription>{children}</ProteaAIDescription>}
    </ProteaAICard>
  );
};
