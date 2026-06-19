import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FlaskConical, ExternalLink } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import { useSetAtom } from "jotai";
import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadDescription,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadGenerateTestProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  description?: string;
}

export const DyadGenerateTest: React.FC<DyadGenerateTestProps> = ({
  children,
  node,
  path: pathProp,
  description: descriptionProp,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);

  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const aborted = state === "aborted";
  const inProgress = state === "pending";

  const fileName = path ? path.split("/").pop() : "";

  const openTestsPanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewMode("tests");
    setIsPreviewOpen(true);
  };

  return (
    <DyadCard
      state={state}
      accentColor="teal"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
      data-testid="dyad-generate-test"
    >
      <DyadCardHeader icon={<FlaskConical size={15} />} accentColor="teal">
        <div className="min-w-0 truncate flex items-center gap-2">
          <DyadBadge color="teal">TEST</DyadBadge>
          <div className="min-w-0 truncate">
            {fileName && (
              <span className="font-medium text-sm text-foreground truncate block">
                {fileName}
              </span>
            )}
            {path && (
              <span className="text-[11px] text-muted-foreground truncate block">
                {path}
              </span>
            )}
          </div>
        </div>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Writing test..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto flex items-center gap-1">
          {!inProgress && (
            <button
              onClick={openTestsPanel}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer"
              aria-label="View in Tests panel"
            >
              <ExternalLink size={14} />
              View in Tests
            </button>
          )}
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      {description && (
        <DyadDescription>
          <span className={!isContentVisible ? "line-clamp-2" : undefined}>
            <span className="font-medium">Test: </span>
            {description}
          </span>
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
