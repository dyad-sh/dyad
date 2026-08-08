import type React from "react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Search, ArrowLeftRight } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";
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

interface DyadSearchReplaceProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  description?: string;
}

export const DyadSearchReplace: React.FC<DyadSearchReplaceProps> = ({
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

  const blocks = useMemo(
    () => parseSearchReplaceBlocks(String(children ?? "")),
    [children],
  );

  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard
      state={state}
      accentColor="violet"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
      data-testid="dyad-search-replace"
    >
      <DyadCardHeader icon={<Search size={15} />} accentColor="violet">
        <DyadBadge color="violet">Search & Replace</DyadBadge>
        {fileName && (
          <span className="font-medium text-sm text-foreground truncate">
            {fileName}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator
            state="pending"
            pendingLabel="Applying changes..."
          />
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
          {blocks.length === 0 ? (
            <CodeHighlight className="language-typescript">
              {children}
            </CodeHighlight>
          ) : (
            <div className="space-y-2">
              {blocks.map((b, i) => (
                <div
                  key={i}
                  className="border border-border/60 rounded-lg overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-[11px]">
                    <ArrowLeftRight
                      size={13}
                      className="text-muted-foreground"
                    />
                    <span className="font-medium text-muted-foreground">
                      Change {i + 1}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                    <div className="p-3 border-t border-border/40 md:border-r">
                      <div className="text-[11px] mb-1 text-muted-foreground font-medium">
                        Search
                      </div>
                      <CodeHighlight className="language-typescript">
                        {b.searchContent}
                      </CodeHighlight>
                    </div>
                    <div className="p-3 border-t border-border/40">
                      <div className="text-[11px] mb-1 text-muted-foreground font-medium">
                        Replace
                      </div>
                      <CodeHighlight className="language-typescript">
                        {b.replaceContent}
                      </CodeHighlight>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
