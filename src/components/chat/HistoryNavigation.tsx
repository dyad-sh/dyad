import React, { useCallback, useEffect } from "react";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  KEY_ARROW_UP_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from "lexical";

export const HISTORY_TRIGGER = "\u200B";

interface HistoryNavigationProps {
  messageHistory: string[];
  onTriggerInserted: () => void;
  onTriggerCleared: () => void;
}

export function HistoryNavigation({
  messageHistory,
  onTriggerInserted,
  onTriggerCleared,
}: HistoryNavigationProps) {
  const [editor] = useLexicalComposerContext();

  const handleArrowUp = useCallback(
    (event: KeyboardEvent) => {
      if (messageHistory.length === 0) {
        return false;
      }

      // Check if input is empty
      let isEmpty = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        isEmpty = root.getTextContent().trim().length === 0;
      });

      // Only trigger history menu if input is empty
      if (!isEmpty) {
        return false;
      }

      // Prevent default to avoid scrolling or other behavior
      event.preventDefault();

      // Insert an invisible trigger character to open the history menu
      onTriggerInserted();

      editor.update(() => {
        const root = $getRoot();

        // Clear existing content and insert trigger
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(HISTORY_TRIGGER));
        root.append(paragraph);

        // Move cursor after the trigger character
        paragraph.selectEnd();
      });

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
          isTriggerOnly = textContent.trim() === HISTORY_TRIGGER;
        });

        if (!isTriggerOnly) {
          return false;
        }

        event.preventDefault();
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
    };
  }, [editor, handleArrowUp, onTriggerCleared]);

  return null;
}
