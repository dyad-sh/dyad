import type React from "react";
import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIFilePath,
  ProteaAIDescription,
  ProteaAIStateIndicator,
} from "./ProteaAICardPrimitives";
import { CustomTagState } from "./stateTypes";

interface ProteaAICopyProps {
  children?: ReactNode;
  node?: any;
}

export const ProteaAICopy: React.FC<ProteaAICopyProps> = ({ children, node }) => {
  const from = node?.properties?.from || "";
  const to = node?.properties?.to || "";
  const description = node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const toFileName = to ? to.split("/").pop() : "";
  // Hide the "From" line for temp attachment paths (absolute paths) since they
  // show cryptic hash filenames that mean nothing to the user.
  const isTempAttachment =
    /^(\/|[A-Za-z]:\\)/.test(from) || from.includes(".proteaai/media/");

  return (
    <ProteaAICard accentColor="teal" state={state}>
      <ProteaAICardHeader icon={<Copy size={15} />} accentColor="teal">
        {toFileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {toFileName}
          </span>
        )}
        <ProteaAIBadge color="teal">Copy</ProteaAIBadge>
        <span className="ml-auto">
          {state === "pending" && (
            <ProteaAIStateIndicator state="pending" pendingLabel="Copying..." />
          )}
          {state === "aborted" && (
            <ProteaAIStateIndicator state="aborted" abortedLabel="Did not finish" />
          )}
          {state === "finished" && (
            <ProteaAIStateIndicator state="finished" finishedLabel="Copied" />
          )}
        </span>
      </ProteaAICardHeader>
      {from && !isTempAttachment && <ProteaAIFilePath path={`From: ${from}`} />}
      {to && <ProteaAIFilePath path={`To: ${to}`} />}
      {description && <ProteaAIDescription>{description}</ProteaAIDescription>}
      {children && <ProteaAIDescription>{children}</ProteaAIDescription>}
    </ProteaAICard>
  );
};
