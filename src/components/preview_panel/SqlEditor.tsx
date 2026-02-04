import { useState, useRef, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { useTheme } from "@/contexts/ThemeContext";
import { Play, Loader2 } from "lucide-react";
import "@/components/chat/monaco";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SqlEditorProps {
  onExecute: (query: string) => void;
  isExecuting: boolean;
  defaultValue?: string;
}

export function SqlEditor({
  onExecute,
  isExecuting,
  defaultValue = "SELECT * FROM users LIMIT 10;",
}: SqlEditorProps) {
  const { theme } = useTheme();
  const [value, setValue] = useState<string>(defaultValue);
  const editorRef = useRef<any>(null);

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorTheme = isDarkMode ? "dyad-dark" : "dyad-light";

  const handleExecute = useCallback(() => {
    const query = value.trim();
    if (query && !isExecuting) {
      onExecute(query);
    }
  }, [value, isExecuting, onExecute]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Add keyboard shortcut for executing query (Ctrl/Cmd + Enter)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleExecute();
    });

    // Focus the editor
    editor.focus();
  };

  const handleEditorChange = (newValue: string | undefined) => {
    setValue(newValue ?? "");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <span className="text-sm font-medium text-muted-foreground">
          SQL Editor
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              size="sm"
              onClick={handleExecute}
              disabled={isExecuting || !value.trim()}
              className="gap-1.5"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Execute query (Ctrl+Enter / Cmd+Enter)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={value}
          theme={editorTheme}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            fontFamily: "monospace",
            fontSize: 13,
            lineNumbers: "on",
            tabSize: 2,
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            renderLineHighlight: "line",
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
            },
          }}
        />
      </div>
    </div>
  );
}
