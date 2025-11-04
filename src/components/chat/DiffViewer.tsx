import React, { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { useTheme } from "@/hooks/useTheme";
import { Loader } from "lucide-react";

export interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  path?: string;
  onModifiedChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  original,
  modified,
  language = "typescript",
  path = "",
  onModifiedChange,
  readOnly = false,
  height = "500px",
}) => {
  const { isDark } = useTheme();
  const [isEditing, setIsEditing] = useState(false);

  // Determine language from file extension
  const getLanguage = () => {
    if (language) return language;
    if (!path) return "typescript";

    const ext = path.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      css: "css",
      scss: "scss",
      html: "html",
      md: "markdown",
      py: "python",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      sh: "shell",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      sql: "sql",
    };

    return languageMap[ext || ""] || "typescript";
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && onModifiedChange) {
      onModifiedChange(value);
      setIsEditing(true);
    }
  };

  return (
    <div className="diff-viewer-container border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-(--background-lightest) border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--foreground)">
            {path || "Untitled"}
          </span>
          {isEditing && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (Modified)
            </span>
          )}
        </div>
        <div className="text-xs text-(--foreground-muted)">
          {readOnly ? "View Only" : "Editable"}
        </div>
      </div>

      {/* Diff Editor */}
      <DiffEditor
        original={original}
        modified={modified}
        language={getLanguage()}
        theme={isDark ? "vs-dark" : "light"}
        height={height}
        options={{
          renderSideBySide: true,
          readOnly: readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "off",
          wrappingIndent: "none",
          renderWhitespace: "selection",
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          // Enable inline editing on the modified side
          originalEditable: false,
          // Diff-specific options
          ignoreTrimWhitespace: false,
          renderIndicators: true,
          enableSplitViewResizing: true,
        }}
        onChange={handleEditorChange}
        loading={
          <div className="flex items-center justify-center h-full">
            <Loader className="animate-spin" size={24} />
          </div>
        }
      />
    </div>
  );
};

/**
 * Simplified diff viewer for small changes (inline)
 */
export const InlineDiffViewer: React.FC<DiffViewerProps> = ({
  original,
  modified,
  language = "typescript",
  path = "",
  height = "300px",
}) => {
  const { isDark } = useTheme();

  const getLanguage = () => {
    if (language) return language;
    if (!path) return "typescript";
    const ext = path.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      css: "css",
      html: "html",
      md: "markdown",
    };
    return languageMap[ext || ""] || "typescript";
  };

  return (
    <div className="inline-diff-viewer rounded-md overflow-hidden border border-border">
      <DiffEditor
        original={original}
        modified={modified}
        language={getLanguage()}
        theme={isDark ? "vs-dark" : "light"}
        height={height}
        options={{
          renderSideBySide: false, // Inline view
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: "off",
          glyphMargin: false,
          folding: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          renderIndicators: true,
        }}
      />
    </div>
  );
};
