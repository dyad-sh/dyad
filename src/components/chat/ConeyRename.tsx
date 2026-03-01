import type React from "react";
import type { ReactNode } from "react";
import { FileEdit } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyFilePath,
  ConeyDescription,
} from "./ConeyCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ConeyRenameProps {
  children?: ReactNode;
  node?: any;
  from?: string;
  to?: string;
}

export const ConeyRename: React.FC<ConeyRenameProps> = ({
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
    <ConeyCard accentColor="amber" state={state}>
      <ConeyCardHeader icon={<FileEdit size={15} />} accentColor="amber">
        {displayTitle && (
          <span className="font-medium text-sm text-foreground truncate">
            {displayTitle}
          </span>
        )}
        <ConeyBadge color="amber">Rename</ConeyBadge>
      </ConeyCardHeader>
      {from && <ConeyFilePath path={`From: ${from}`} />}
      {to && <ConeyFilePath path={`To: ${to}`} />}
      {children && <ConeyDescription>{children}</ConeyDescription>}
    </ConeyCard>
  );
};
