import type React from "react";
import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadFilePath,
  DyadDescription,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface DyadCopyProps {
  children?: ReactNode;
  node?: any;
}

export const DyadCopy: React.FC<DyadCopyProps> = ({ children, node }) => {
  const from = node?.properties?.from || "";
  const to = node?.properties?.to || "";
  const description = node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const toFileName = to ? to.split("/").pop() : "";

  return (
    <DyadCard accentColor="teal" state={state}>
      <DyadCardHeader icon={<Copy size={15} />} accentColor="teal">
        {toFileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {toFileName}
          </span>
        )}
        <DyadBadge color="teal">Copy</DyadBadge>
      </DyadCardHeader>
      {from && <DyadFilePath path={`From: ${from}`} />}
      {to && <DyadFilePath path={`To: ${to}`} />}
      {description && <DyadDescription>{description}</DyadDescription>}
      {children && <DyadDescription>{children}</DyadDescription>}
    </DyadCard>
  );
};
