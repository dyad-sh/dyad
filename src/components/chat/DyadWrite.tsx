import type React from "react";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Pencil,
  Loader,
  CircleX,
  Edit,
  X,
  GitCompare,
} from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import { FileEditor } from "../preview_panel/FileEditor";
import { DiffViewer } from "./DiffViewer";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useQuery } from "@tanstack/react-query";

interface DyadWriteProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  description?: string;
}

export const DyadWrite: React.FC<DyadWriteProps> = ({
  children,
  node,
  path: pathProp,
  description: descriptionProp,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Use props directly if provided, otherwise extract from node
  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const aborted = state === "aborted";
  const appId = useAtomValue(selectedAppIdAtom);
  const [isEditing, setIsEditing] = useState(false);
  const inProgress = state === "pending";

  // Get the new content from children
  const newContent = typeof children === "string" ? children : "";

  // Fetch original file content for diff view
  const { data: originalContent } = useQuery({
    queryKey: ["file-content", appId, path],
    queryFn: async () => {
      if (!appId || !path) return "";
      try {
        const result = await window.electron.ipc.invoke("load-app-file", {
          appId,
          filePath: path,
        });
        return result || "";
      } catch (error) {
        // File might not exist yet (new file)
        return "";
      }
    },
    enabled: !!(appId && path && showDiff),
  });

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setIsContentVisible(true);
  };
  // Extract filename from path
  const fileName = path ? path.split("/").pop() : "";

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress
          ? "border-amber-500"
          : aborted
            ? "border-red-500"
            : "border-border"
      }`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pencil size={16} />
          {fileName && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {fileName}
            </span>
          )}
          {inProgress && (
            <div className="flex items-center text-amber-600 text-xs">
              <Loader size={14} className="mr-1 animate-spin" />
              <span>Writing...</span>
            </div>
          )}
          {aborted && (
            <div className="flex items-center text-red-600 text-xs">
              <CircleX size={14} className="mr-1" />
              <span>Did not finish</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!inProgress && (
            <>
              {/* Diff Toggle Button */}
              {originalContent !== undefined && !isEditing && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDiff(!showDiff);
                    if (!isContentVisible) setIsContentVisible(true);
                  }}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer ${
                    showDiff
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <GitCompare size={14} />
                  Diff
                </button>
              )}

              {/* Edit Button */}
              {isEditing ? (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel();
                    }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded cursor-pointer"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit();
                  }}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded cursor-pointer"
                >
                  <Edit size={14} />
                  Edit
                </button>
              )}
            </>
          )}
          {isContentVisible ? (
            <ChevronsDownUp
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          ) : (
            <ChevronsUpDown
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          )}
        </div>
      </div>
      {path && (
        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
          {path}
        </div>
      )}
      {description && (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium">Summary: </span>
          {description}
        </div>
      )}
      {isContentVisible && (
        <div
          className="text-xs cursor-text mt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            <div className="h-96 min-h-96 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
              <FileEditor appId={appId ?? null} filePath={path} />
            </div>
          ) : showDiff && originalContent !== undefined ? (
            <DiffViewer
              original={originalContent}
              modified={newContent}
              path={path}
              readOnly={true}
              height="400px"
            />
          ) : (
            <CodeHighlight className="language-typescript">
              {children}
            </CodeHighlight>
          )}
        </div>
      )}
    </div>
  );
};
