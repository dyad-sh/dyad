import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Rabbit } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadFilePath,
  DyadDescription,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadEditProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  description?: string;
}

export const DyadEdit: React.FC<DyadEditProps> = ({
  children,
  node,
  path: pathProp,
  description: descriptionProp,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard
      state={state}
      accentColor="sky"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
    >
      <DyadCardHeader icon={<Rabbit size={15} />} accentColor="sky">
        <DyadBadge color="sky">Turbo Edit</DyadBadge>
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Editing..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadFilePath path={path} />
      {description && (
        <DyadDescription>
          <span className="font-medium">Summary: </span>
          {description}
        </DyadDescription>
      )}
      <DyadCardContent isExpanded={isContentVisible}>
        <div
          className="text-xs cursor-text"
          onClick={(e) => e.stopPropagation()}
        >
          <CodeHighlight className="language-typescript">
            {children}
          </CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
