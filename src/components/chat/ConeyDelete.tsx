import type React from "react";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyFilePath,
  ConeyDescription,
} from "./ConeyCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ConeyDeleteProps {
  children?: ReactNode;
  node?: any;
  path?: string;
}

export const ConeyDelete: React.FC<ConeyDeleteProps> = ({
  children,
  node,
  path: pathProp,
}) => {
  const path = pathProp || node?.properties?.path || "";
  const state = node?.properties?.state as CustomTagState;
  const fileName = path ? path.split("/").pop() : "";

  return (
    <ConeyCard accentColor="red" state={state}>
      <ConeyCardHeader icon={<Trash2 size={15} />} accentColor="red">
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        <ConeyBadge color="red">Delete</ConeyBadge>
      </ConeyCardHeader>
      <ConeyFilePath path={path} />
      {children && <ConeyDescription>{children}</ConeyDescription>}
    </ConeyCard>
  );
};
