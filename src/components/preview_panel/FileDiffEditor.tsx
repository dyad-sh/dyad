import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useEffect, useRef } from "react";
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
  const { isDarkMode } = useTheme();
  const editorTheme = isDarkMode ? "dyad-dark" : "dyad-light";
  const modelsRef = useRef<MonacoEditor.ITextModel[]>([]);

  const handleMount: DiffOnMount = (editor) => {
    const models = editor.getModel();
    modelsRef.current = models ? [models.original, models.modified] : [];
  };

  // On unmount, @monaco-editor/react@4.7.0 disposes the two text models *before*
  // it disposes the diff widget that still holds them. Monaco reacts to that
  // with a BugIndicatingError ("TextModel got disposed before DiffEditorWidget
  // model got reset") whose default handler rethrows asynchronously, so every
  // closed/switched diff view produced an uncaught error in the renderer.
  //
  // `keepCurrent*Model` stops the library from touching the models, leaving it
  // to only dispose the widget. We then dispose the models ourselves in a
  // microtask, which runs after React has finished the unmount commit (and thus
  // after the widget is gone), so the order is correct and nothing leaks.
  useEffect(() => {
    return () => {
      const models = modelsRef.current;
      modelsRef.current = [];
      if (models.length === 0) {
        return;
      }
      queueMicrotask(() => {
        for (const model of models) {
          if (!model.isDisposed()) {
            model.dispose();
          }
        }
      });
    };
  }, []);

  return (
    <div className="h-full w-full" data-testid="version-diff-editor">
      <DiffEditor
        height="100%"
        language={getLanguage(filePath)}
        original={oldContent}
        modified={newContent}
        theme={editorTheme}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        onMount={handleMount}
        options={{
          readOnly: true,
          renderSideBySide: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "off",
          fontFamily: "monospace",
          fontSize: 13,
          lineNumbers: "on",
        }}
      />
    </div>
  );
}
