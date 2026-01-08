import React, { useCallback, useEffect } from "react";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";

interface HistoryNavigationProps {
  messageHistory: string[];
  onChange: (value: string) => void;
}

export function HistoryNavigation({
  messageHistory,
  onChange,
}: HistoryNavigationProps) {
  const [editor] = useLexicalComposerContext();
  const historyIndexRef = React.useRef<number>(-1);
  const draftRef = React.useRef<string>("");

  useEffect(() => {
    // Reset history index when history changes (e.g., new message sent)
    historyIndexRef.current = -1;
    draftRef.current = "";
  }, [messageHistory]);

  const isMentionsMenuOpen = useCallback(() => {
    const mentionsMenu = document.querySelector('[data-mentions-menu="true"]');
    return !!(mentionsMenu && mentionsMenu.children.length > 0);
  }, []);

  const setEditorContent = useCallback(
    (text: string) => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text) {
          paragraph.append($createTextNode(text));
        }
        root.append(paragraph);
        paragraph.selectEnd();
      });
      onChange(text);
    },
    [editor, onChange],
  );

  const handleArrowUp = useCallback(
    (event: KeyboardEvent) => {
      // Check if mentions menu is open
      if (isMentionsMenuOpen()) {
        return false;
      }

      if (messageHistory.length === 0) {
        return false;
      }

      // Check if input is empty (only start navigation when input is empty)
      let isEmpty = false;
      let currentText = "";
      editor.getEditorState().read(() => {
        const root = $getRoot();
        currentText = root.getTextContent();
        isEmpty = currentText.length === 0;
      });

      // Only start navigation if input is empty OR we're already navigating
      if (historyIndexRef.current === -1 && !isEmpty) {
        return false;
      }

      // Save current draft when starting navigation
      if (historyIndexRef.current === -1) {
        draftRef.current = currentText;
      }

      // Move to previous history item
      if (historyIndexRef.current < messageHistory.length - 1) {
        event.preventDefault();
        historyIndexRef.current += 1;
        const historyItem = messageHistory[historyIndexRef.current];
        setEditorContent(historyItem);
        return true;
      }

      return false;
    },
    [editor, messageHistory, isMentionsMenuOpen, setEditorContent],
  );

  const handleArrowDown = useCallback(
    (event: KeyboardEvent) => {
      // Check if mentions menu is open
      if (isMentionsMenuOpen()) {
        return false;
      }

      // Only handle if we're currently navigating history
      if (historyIndexRef.current === -1) {
        return false;
      }

      event.preventDefault();

      // Move to next history item (or back to draft)
      if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
        const historyItem = messageHistory[historyIndexRef.current];
        setEditorContent(historyItem);
        return true;
      } else {
        // Go back to draft (empty or saved draft)
        historyIndexRef.current = -1;
        const draft = draftRef.current;
        draftRef.current = "";
        setEditorContent(draft);
        return true;
      }
    },
    [messageHistory, isMentionsMenuOpen, setEditorContent],
  );

  useEffect(() => {
    const unregisterUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      handleArrowUp,
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      handleArrowDown,
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterUp();
      unregisterDown();
    };
  }, [editor, handleArrowUp, handleArrowDown]);

  return null;
}
