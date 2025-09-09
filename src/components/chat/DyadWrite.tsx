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
  Save,
  X,
} from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import Editor from "@monaco-editor/react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue } from "jotai";
import { useTheme } from "@/contexts/ThemeContext";

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
  const [isEditing, setIsEditing] = useState(false);
  const [code, setCode] = useState(
    children
      ? Array.isArray(children)
        ? children.join("")
        : String(children)
      : "",
  );
  const [originalCode, setOriginalCode] = useState(
    children
      ? Array.isArray(children)
        ? children.join("")
        : String(children)
      : "",
  );
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const { theme } = useTheme();

  useEffect(() => {
    const newCode = children
      ? Array.isArray(children)
        ? children.join("")
        : String(children)
      : "";
    setCode(newCode);
    setOriginalCode(newCode);
  }, [children]);

  const [isDarkMode, setIsDarkMode] = useState(false);
  // Determine if dark mode based on theme
  useEffect(() => {
    // Safe access to window APIs
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setIsDarkMode(isDark);
  }, [theme]);
  const editorTheme = isDarkMode ? "dyad-dark" : "dyad-light";

  // Determine language based on file extension
  const getLanguage = (filePath: string) => {
    const extension = filePath.split(".").pop()?.toLowerCase() || "";
    const languageMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      py: "python",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      go: "go",
      rs: "rust",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      // Add more as needed
    };

    return languageMap[extension] || "plaintext";
  };

  // Use props directly if provided, otherwise extract from node
  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  // Extract filename from path
  const fileName = path ? path.split("/").pop() : "";
  const handleSave = async () => {
    if (!chatId) {
      return;
    }
    const prompt = `Edit ${path}:\n\n\`\`\`${getLanguage(path)}\n${code}\n\`\`\``;
    try {
      await streamMessage({ prompt, chatId });
      setIsEditing(false);
      setOriginalCode(code); // Update original code to current code
    } catch (error) {
      // Handle error appropriately
    }
  };

  const handleCancel = () => {
    setCode(originalCode); // Revert to original code
    setIsEditing(false);
  };

  const handleEdit = () => {
    setOriginalCode(code); // Save current state as original before editing
    setIsEditing(true);
    setIsContentVisible(true);
  };

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
        <div className="flex items-center">
          {!inProgress && (
            <>
              {isEditing ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded cursor-pointer"
                  >
                    <X size={14} />
                    Cancel
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleSave(); }}
                    className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded cursor-pointer"
                  >
                    <Save size={14} />
                    Save
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
          className="text-xs cursor-text"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            <Editor
              height="300px"
              defaultLanguage={getLanguage(path)}
              value={code}
              theme={editorTheme}
              onChange={(value) => setCode(value || "")}
              options={{
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                fontFamily: "monospace",
                fontSize: 13,
                lineNumbers: "on",
              }}
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
