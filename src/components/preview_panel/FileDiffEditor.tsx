import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import "@/components/chat/monaco";
import { useTheme } from "@/contexts/ThemeContext";
import { getLanguage } from "@/utils/get_language";
import { ipc, type UncommittedFileDiff } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess, showWarning } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import {
  diffDirtyAtom,
  diffSaveRequestAtom,
  diffSavingAtom,
} from "@/atoms/viewAtoms";
import { useSwitchedToMainBranch } from "@/hooks/useSwitchedToMainBranch";
import { enqueueFileSave, getFileSaveQueueKey } from "./fileSaveQueue";

// Compare content ignoring cross-platform line-ending differences (`\r\n` on
// Windows vs `\n` on Unix) so a file never looks dirty (or gets redundantly
// saved) purely because of its line-ending style.
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");

interface FileDiffEditorProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  /**
   * When true (and `appId` is provided), the modified (right/new) pane becomes
   * editable and can be saved back to the working file. The original (left)
   * pane always stays read-only.
   */
  editable?: boolean;
  appId?: number;
  targetBranchName?: string;
  expectedBranchTipOid?: string;
  restartOnSwitchedToMainBranch?: boolean;
}

/**
 * Monaco diff editor showing the parent ("original") content on the left and
 * the selected commit's ("modified") content on the right. Read-only by
 * default; when `editable` is set, the modified pane can be edited and saved.
 */
export function FileDiffEditor({
  filePath,
  oldContent,
  newContent,
  editable = false,
  appId,
  targetBranchName,
  expectedBranchTipOid,
  restartOnSwitchedToMainBranch = false,
}: FileDiffEditorProps) {
  const { t } = useTranslation("home");
  const { isDarkMode } = useTheme();
  const editorTheme = isDarkMode ? "dyad-dark" : "dyad-light";
  const queryClient = useQueryClient();

  const modifiedEditorRef = useRef<MonacoEditor.ICodeEditor | null>(null);
  const isSavingRef = useRef(false);
  // The dirty/saving atoms are shared across all diff editors, but this
  // component is remounted (via its `key`) when the file or edit mode changes.
  // A save started before that switch keeps running against the new editor's
  // atoms, so a stale completion could clear the new editor's dirty flag or
  // disable its Save button. Track mount state and skip those shared writes once
  // this instance is gone.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Kept in a ref so the dirty check (bound once on mount) always compares
  // against the current baseline, which shifts to the saved content after a
  // save re-baselines the diff.
  const newContentRef = useRef(newContent);
  const lastNewContentPropRef = useRef(newContent);
  useEffect(() => {
    if (newContent !== lastNewContentPropRef.current) {
      lastNewContentPropRef.current = newContent;
      newContentRef.current = newContent;
    }
  }, [newContent]);
  const setDirty = useSetAtom(diffDirtyAtom);
  const setSaving = useSetAtom(diffSavingAtom);
  const saveRequest = useAtomValue(diffSaveRequestAtom);
  const handleSwitchedToMainBranch = useSwitchedToMainBranch();

  const performSave = async () => {
    const modified = modifiedEditorRef.current;
    if (!editable || appId == null || !modified || isSavingRef.current) {
      return;
    }
    const content = modified.getValue();
    // The content the editor is currently baselined against (the committed blob
    // for a version diff, re-baselined to the saved content after each save).
    const baseline = newContentRef.current;
    if (normalizeLineEndings(content) === normalizeLineEndings(baseline)) {
      return;
    }

    isSavingRef.current = true;
    if (isMountedRef.current) {
      setSaving(true);
    }
    try {
      const result = await enqueueFileSave(
        getFileSaveQueueKey(appId, filePath),
        () =>
          ipc.app.editAppFile({
            appId,
            filePath,
            content,
            targetBranchName,
            expectedBranchTipOid,
            // Only meaningful for a version diff (which shows the committed blob
            // rather than the working-tree file); lets the handler reject the
            // save instead of clobbering uncommitted on-disk edits it never
            // showed. Omitted for staged diffs, whose content is the file.
            expectedFileContent: targetBranchName ? baseline : undefined,
          }),
      );
      const { warning } = result;
      // If the edit was made while a historical version was checked out, the
      // backend re-attached to a branch so the edit lands as a new version on
      // top of it; refresh branch/version state and restart the app to match.
      await handleSwitchedToMainBranch(appId, result, {
        restartApp: restartOnSwitchedToMainBranch,
      });
      // Mirror FileEditor.saveFile: refresh the file content, versions list, the
      // staged/uncommitted files list, and re-baseline this diff against the
      // just-saved content without forcing Monaco to reload a newer in-flight
      // edit from query props.
      queryClient.setQueryData(
        queryKeys.appFiles.content({ appId, filePath }),
        content,
      );
      newContentRef.current = content;
      lastNewContentPropRef.current = content;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      // Mirror FileEditor.saveFile: if the user kept typing during the async
      // save, keep the dirty flag set so the Save button stays enabled for the
      // newer edits instead of briefly (and misleadingly) disabling itself.
      const hasNewerEdits =
        normalizeLineEndings(modified.getValue()) !==
        normalizeLineEndings(content);
      if (!hasNewerEdits) {
        queryClient.setQueryData<UncommittedFileDiff>(
          queryKeys.uncommittedFiles.diff({ appId, filePath }),
          (previous) =>
            previous ? { ...previous, newContent: content } : previous,
        );
      }
      // Only touch the shared dirty atom if this editor is still mounted, so a
      // save that finishes after the user switched files can't clear the new
      // editor's dirty state.
      if (isMountedRef.current) {
        setDirty(hasNewerEdits);
      }
      if (warning) {
        showWarning(warning);
      } else {
        showSuccess(t("preview.fileSaved"));
      }
    } catch (error) {
      showError(error);
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };
  const performSaveRef = useRef(performSave);
  performSaveRef.current = performSave;

  // Save when the toolbar Save button (or another trigger) bumps the request
  // counter. Skips the initial mount value so opening a file never auto-saves.
  const initialSaveRequestRef = useRef(saveRequest);
  useEffect(() => {
    if (saveRequest === initialSaveRequestRef.current) {
      return;
    }
    void performSaveRef.current();
  }, [saveRequest]);

  const handleMount: DiffOnMount = (editor, monaco) => {
    const modified = editor.getModifiedEditor();
    modifiedEditorRef.current = modified;
    modified.onDidChangeModelContent(() => {
      setDirty(
        normalizeLineEndings(modified.getValue()) !==
          normalizeLineEndings(newContentRef.current),
      );
    });
    modified.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void performSaveRef.current();
    });
  };

  return (
    <div className="h-full w-full" data-testid="version-diff-editor">
      <DiffEditor
        height="100%"
        language={getLanguage(filePath)}
        original={oldContent}
        modified={newContent}
        theme={editorTheme}
        onMount={handleMount}
        options={{
          readOnly: !editable,
          originalEditable: false,
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
