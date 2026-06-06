import { DiffEditor } from "@monaco-editor/react";
import "@/components/chat/monaco";
import { useTheme } from "@/contexts/ThemeContext";
import { getLanguage } from "@/utils/get_language";

interface FileDiffEditorProps {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Read-only Monaco diff editor showing the parent ("original") content on the
 * left and the selected commit's ("modified") content on the right.
 */
export function FileDiffEditor({
  filePath,
  oldContent,
  newContent,
}: FileDiffEditorProps) {
  const { theme } = useTheme();
  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorTheme = isDarkMode ? "dyad-dark" : "dyad-light";

  return (
    <div className="h-full w-full" data-testid="version-diff-editor">
      <DiffEditor
        height="100%"
        language={getLanguage(filePath)}
        original={oldContent}
        modified={newContent}
        theme={editorTheme}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          fontFamily: "monospace",
          fontSize: 13,
          lineNumbers: "on",
        }}
      />
    </div>
  );
}
