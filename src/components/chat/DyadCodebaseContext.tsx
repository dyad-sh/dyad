import React, { useState, useEffect } from "react";
import { ChevronUp, ChevronDown, Code2, FileText } from "lucide-react";
import { CustomTagState } from "./stateTypes";

interface DyadCodebaseContextProps {
  children: React.ReactNode;
  node?: {
    properties?: {
      files?: string;
      state?: CustomTagState;
    };
  };
}

export const DyadCodebaseContext: React.FC<DyadCodebaseContextProps> = ({
  node,
}) => {
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);
  const files = node?.properties?.files?.split(",") || [];

  // Collapse when transitioning from in-progress to not-in-progress
  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  return (
    <div
      className={`relative bg-(--background-lightest) dark:bg-zinc-900 hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress ? "border-blue-500" : "border-border"
      }`}
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
        className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-blue-500 bg-white dark:bg-zinc-900"
        style={{ zIndex: 1 }}
      >
        <Code2 size={16} className="text-blue-500" />
        <span>Codebase Context</span>
      </div>

      {/* File count when collapsed */}
      {files.length > 0 && (
        <div className="absolute top-2 left-40 flex items-center">
          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 text-xs rounded text-gray-600 dark:text-gray-300">
            Using {files.length} file{files.length !== 1 ? "s" : ""}
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
          marginBottom: isExpanded ? "0" : "-6px", // Compensate for padding
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
                    className="px-2 py-1     bg-gray-100 dark:bg-zinc-800 rounded-lg"
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
