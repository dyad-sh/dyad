import type React from "react";
import type { ReactNode } from "react";
import { FileEdit } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIFilePath,
  ProteaAIDescription,
} from "./ProteaAICardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ProteaAIRenameProps {
  children?: ReactNode;
  node?: any;
  from?: string;
  to?: string;
}

export const ProteaAIRename: React.FC<ProteaAIRenameProps> = ({
  children,
  node,
  from: fromProp,
  to: toProp,
}) => {
  const from = fromProp || node?.properties?.from || "";
  const to = toProp || node?.properties?.to || "";
  const state = node?.properties?.state as CustomTagState;

  const fromFileName = from ? from.split("/").pop() : "";
  const toFileName = to ? to.split("/").pop() : "";

  const displayTitle =
    fromFileName && toFileName
      ? `${fromFileName} → ${toFileName}`
      : fromFileName || toFileName || "";

  return (
    <ProteaAICard accentColor="amber" state={state}>
      <ProteaAICardHeader icon={<FileEdit size={15} />} accentColor="amber">
        {displayTitle && (
          <span className="font-medium text-sm text-foreground truncate">
            {displayTitle}
          </span>
        )}
        <ProteaAIBadge color="amber">Rename</ProteaAIBadge>
      </ProteaAICardHeader>
      {from && <ProteaAIFilePath path={`From: ${from}`} />}
      {to && <ProteaAIFilePath path={`To: ${to}`} />}
      {children && <ProteaAIDescription>{children}</ProteaAIDescription>}
    </ProteaAICard>
  );
};
