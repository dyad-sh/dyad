import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, FileCode, FileText } from "lucide-react";

interface DyadCodeSearchResultProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadCodeSearchResult: React.FC<DyadCodeSearchResultProps> = ({
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse file paths from children content
  const files = useMemo(() => {
    if (typeof children !== "string") {
      return [];
    }

    const filePaths: string[] = [];
    const lines = children.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      // Skip empty lines and lines that look like tags
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
    <div
      className="relative bg-(--background-lightest) dark:bg-zinc-900 hover:bg-(--background-lighter) rounded-lg px-4 py-2 border border-border my-2 cursor-pointer"
      onClick={() => setIsExpanded(!isExpanded)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }
      }}
    >
      {/* Top-left label badge */}
      <div
        className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-purple-600 bg-white dark:bg-zinc-900"
        style={{ zIndex: 1 }}
      >
        <FileCode size={16} className="text-purple-600" />
        <span>Code Search Result</span>
      </div>

      {/* File count when collapsed */}
      {files.length > 0 && (
        <div className="absolute top-2 left-44 flex items-center">
          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 text-xs rounded text-gray-600 dark:text-gray-300">
            Found {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Indicator icon */}
      <div className="absolute top-2 right-2 p-1 text-gray-500">
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {/* Main content with smooth transition */}
      <div
        className="pt-6 overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "1000px" : "0px",
          opacity: isExpanded ? 1 : 0,
          marginBottom: isExpanded ? "0" : "-6px",
        }}
      >
        {/* File list when expanded */}
        {files.length > 0 && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2 mt-2">
              {files.map((file, index) => {
                const filePath = file.trim();
                const fileName = filePath.split("/").pop() || filePath;
                const pathPart =
                  filePath.substring(0, filePath.length - fileName.length) ||
                  "";

                return (
                  <div
                    key={index}
                    className="px-2 py-1 bg-gray-100 dark:bg-zinc-800 rounded-lg"
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText
                        size={14}
                        className="text-gray-500 dark:text-gray-400 flex-shrink-0"
                      />
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {fileName}
                      </div>
                    </div>
                    {pathPart && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 ml-5">
                        {pathPart}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
