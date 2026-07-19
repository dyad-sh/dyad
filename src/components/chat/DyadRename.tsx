import type React from "react";
import type { ReactNode } from "react";
import { FileEdit } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadFilePath,
  DyadDescription,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("chat");
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
    <DyadCard accentColor="amber" state={state}>
      <DyadCardHeader icon={<FileEdit size={15} />} accentColor="amber">
        {displayTitle && (
          <span className="font-medium text-sm text-foreground truncate">
            {displayTitle}
          </span>
        )}
        <DyadBadge color="amber">{t("rename")}</DyadBadge>
      </DyadCardHeader>
      {from && <DyadFilePath path={`${t("from")}: ${from}`} />}
      {to && <DyadFilePath path={`${t("to")}: ${to}`} />}
      {children && <DyadDescription>{children}</DyadDescription>}
    </DyadCard>
  );
};
