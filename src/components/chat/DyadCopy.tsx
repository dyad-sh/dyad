import type React from "react";
import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadFilePath,
  DyadDescription,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";
import { useTranslation } from "react-i18next";

interface DyadCopyProps {
  children?: ReactNode;
  node?: any;
}

export const DyadCopy: React.FC<DyadCopyProps> = ({ children, node }) => {
  const { t } = useTranslation("chat");
  const from = node?.properties?.from || "";
  const to = node?.properties?.to || "";
  const description = node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const toFileName = to ? to.split("/").pop() : "";
  // Hide the "From" line for temp attachment paths (absolute paths) since they
  // show cryptic hash filenames that mean nothing to the user.
  const isTempAttachment =
    /^(\/|[A-Za-z]:\\)/.test(from) || from.includes(".dyad/media/");

  return (
    <DyadCard accentColor="teal" state={state}>
      <DyadCardHeader icon={<Copy size={15} />} accentColor="teal">
        {toFileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {toFileName}
          </span>
        )}
        <DyadBadge color="teal">{t("copy")}</DyadBadge>
        <span className="ml-auto">
          {state === "pending" && (
            <DyadStateIndicator state="pending" pendingLabel={t("copying")} />
          )}
          {state === "aborted" && (
            <DyadStateIndicator state="aborted" abortedLabel={t("didNotFinish")} />
          )}
          {state === "finished" && (
            <DyadStateIndicator state="finished" finishedLabel={t("copied")} />
          )}
        </span>
      </DyadCardHeader>
      {from && !isTempAttachment && (
        <DyadFilePath path={`${t("from")}: ${from}`} />
      )}
      {to && <DyadFilePath path={`${t("to")}: ${to}`} />}
      {description && <DyadDescription>{description}</DyadDescription>}
      {children && <DyadDescription>{children}</DyadDescription>}
    </DyadCard>
  );
};
