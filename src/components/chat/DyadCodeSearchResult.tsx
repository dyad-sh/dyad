import React, { useState, useMemo } from "react";
import { FileCode, FileText } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadCodeSearchResultProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadCodeSearchResult: React.FC<DyadCodeSearchResultProps> = ({
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const files = useMemo(() => {
    if (typeof children !== "string") {
      return [];
    }

    const filePaths: string[] = [];
    const lines = children.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        trimmedLine &&
        !trimmedLine.startsWith("<") &&
        !trimmedLine.startsWith(">")
      ) {
        filePaths.push(trimmedLine);
      }
    }

    return filePaths;
  }, [children]);

  return (
    <DyadCard
      accentColor="indigo"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <DyadCardHeader icon={<FileCode size={15} />} accentColor="indigo">
        <DyadBadge color="indigo">Code Search Result</DyadBadge>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Found {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, index) => {
              const filePath = file.trim();
              const fileName = filePath.split("/").pop() || filePath;
              const pathPart =
                filePath.substring(0, filePath.length - fileName.length) || "";

              return (
                <div key={index} className="px-2 py-1 bg-muted/40 rounded-lg">
                  <div className="flex items-center gap-1.5">
                    <FileText
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {fileName}
                    </span>
                  </div>
                  {pathPart && (
                    <div className="text-[11px] text-muted-foreground ml-5 font-mono">
                      {pathPart}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
};
