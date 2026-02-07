import { useCallback, useEffect, useRef } from "react";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  KEY_ARROW_UP_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from "lexical";

export const HISTORY_TRIGGER = "\u200B";

/** Delay (ms) before dispatching KEY_ARROW_UP so the typeahead menu has mounted. */
const SELECT_LAST_DISPATCH_DELAY_MS = 60;

interface HistoryNavigationProps {
  messageHistory: string[];
  onTriggerInserted: () => void;
  onTriggerCleared: () => void;
}

function clearSelectLastTimeout(
  timeoutRef: { current: ReturnType<typeof setTimeout> | null },
  scheduledRef: { current: boolean },
) {
  if (timeoutRef.current != null) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
  scheduledRef.current = false;
}

export function HistoryNavigation({
  messageHistory,
  onTriggerInserted,
  onTriggerCleared,
}: HistoryNavigationProps) {
  const [editor] = useLexicalComposerContext();
  const syntheticUpScheduledRef = useRef(false);
  const selectLastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleArrowUp = useCallback(
    (event: KeyboardEvent) => {
      if (messageHistory.length === 0) {
        return false;
      }

      // Ignore our synthetic KEY_ARROW_UP (we dispatch it to select last item).
      // This also debounces rapid ArrowUp presses: if a press arrives while a
      // synthetic dispatch is scheduled, it's ignored to prevent multiple menus.
      if (syntheticUpScheduledRef.current) {
        syntheticUpScheduledRef.current = false;
        return false;
      }

      let isEmpty = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        isEmpty = root.getTextContent().trim().length === 0;
      });

      if (!isEmpty) {
        return false;
      }

      event.preventDefault();
      onTriggerInserted();

      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(HISTORY_TRIGGER));
        root.append(paragraph);
        paragraph.selectEnd();
      });

      // Dispatch KEY_ARROW_UP after a short delay so the typeahead menu has
      // mounted. Store timeout id and clear on unmount or ESC to avoid leaks.
      syntheticUpScheduledRef.current = true;
      selectLastTimeoutRef.current = setTimeout(() => {
        selectLastTimeoutRef.current = null;
        if (!syntheticUpScheduledRef.current) return;
        editor.dispatchCommand(
          KEY_ARROW_UP_COMMAND,
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
      }, SELECT_LAST_DISPATCH_DELAY_MS);

      return true;
    },
    [editor, messageHistory, onTriggerInserted],
  );

  useEffect(() => {
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      handleArrowUp,
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent) => {
        let isTriggerOnly = false;
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const textContent = root.getTextContent();
          isTriggerOnly = textContent === HISTORY_TRIGGER;
        });

        if (!isTriggerOnly) {
          return false;
        }

        event.preventDefault();
        clearSelectLastTimeout(selectLastTimeoutRef, syntheticUpScheduledRef);
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const paragraph = $createParagraphNode();
          root.append(paragraph);
          paragraph.select();
        });
        onTriggerCleared();
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    return () => {
      unregisterArrowUp();
      unregisterEscape();
      clearSelectLastTimeout(selectLastTimeoutRef, syntheticUpScheduledRef);
    };
  }, [editor, handleArrowUp, onTriggerCleared]);

  return null;
}
