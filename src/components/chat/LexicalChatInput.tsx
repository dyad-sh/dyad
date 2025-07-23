import React, { useCallback, useEffect, useState } from "react";
import {
  $getRoot,
  $getSelection,
  $createParagraphNode,
  $createTextNode,
  EditorState,
  LexicalEditor,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  BeautifulMentionsPlugin,
  BeautifulMentionNode,
  type BeautifulMentionsTheme,
  type BeautifulMentionsMenuItemProps,
} from "lexical-beautiful-mentions";
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";
import { useLoadApps } from "@/hooks/useLoadApps";
import { forwardRef } from "react";

// Define the theme for mentions
const beautifulMentionsTheme: BeautifulMentionsTheme = {
  "@": "px-2 py-0.5 mx-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 rounded-md",
  "@Focused": "outline-none ring-2 ring-indigo-500 dark:ring-indigo-400",
};

// Custom menu item component
const CustomMenuItem = forwardRef<
  HTMLLIElement,
  BeautifulMentionsMenuItemProps
>(({ selected, item, ...props }, ref) => (
  <li
    className={`m-0 flex items-center px-3 py-2 cursor-pointer whitespace-nowrap ${
      selected
        ? "bg-indigo-100 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100"
        : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
    }`}
    {...props}
    ref={ref}
  >
    <div className="flex items-center space-x-2 min-w-0">
      <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 rounded-md flex-shrink-0">
        App
      </span>
      <span className="font-medium truncate">
        {typeof item === "string" ? item : item.value}
      </span>
    </div>
  </li>
));

// Custom menu component
function CustomMenu({ loading, ...props }: any) {
  return (
    <ul
      className="m-0 mb-1 min-w-[300px] w-auto max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        transform: "translateY(-4px)", // Add a small gap between menu and input
      }}
      data-mentions-menu="true"
      {...props}
    />
  );
}

// Plugin to handle Enter key
function EnterKeyPlugin({ onSubmit }: { onSubmit: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        // Check if mentions menu is open by looking for our custom menu element
        const mentionsMenu = document.querySelector(
          '[data-mentions-menu="true"]',
        );
        const hasVisibleItems =
          mentionsMenu && mentionsMenu.children.length > 0;

        if (hasVisibleItems) {
          // If mentions menu is open with items, let the mentions plugin handle the Enter key
          return false;
        }

        if (!event.shiftKey) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH, // Use higher priority to catch before mentions plugin
    );
  }, [editor, onSubmit]);

  return null;
}

// Plugin to clear editor content
function ClearEditorPlugin({
  shouldClear,
  onCleared,
}: {
  shouldClear: boolean;
  onCleared: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (shouldClear) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        paragraph.select();
      });
      onCleared();
    }
  }, [editor, shouldClear, onCleared]);

  return null;
}

interface LexicalChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
}

function onError(error: Error) {
  console.error(error);
}

export function LexicalChatInput({
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder = "Ask Dyad to build...",
  disabled = false,
}: LexicalChatInputProps) {
  const { apps } = useLoadApps();
  const [shouldClear, setShouldClear] = useState(false);

  // Prepare mention items - convert apps to mention format
  const mentionItems = React.useMemo(() => {
    const appMentions = apps?.map((app) => app.name) || [];
    return {
      "@": appMentions,
    };
  }, [apps]);

  const initialConfig = {
    namespace: "ChatInput",
    theme: {
      beautifulMentions: beautifulMentionsTheme,
    },
    onError,
    nodes: [BeautifulMentionNode],
    editable: !disabled,
  };

  const handleEditorChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();
        onChange(textContent);
      });
    },
    [onChange],
  );

  const handleSubmit = useCallback(() => {
    onSubmit();
    setShouldClear(true);
  }, [onSubmit]);

  const handleCleared = useCallback(() => {
    setShouldClear(false);
  }, []);

  // Update editor content when value changes externally (like clearing)
  useEffect(() => {
    if (value === "") {
      setShouldClear(true);
    }
  }, [value]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative flex-1">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="flex-1 p-2 focus:outline-none overflow-y-auto min-h-[40px] max-h-[200px] resize-none"
              aria-placeholder={placeholder}
              placeholder={
                <div className="absolute top-2 left-2 text-gray-500 pointer-events-none select-none">
                  {placeholder}
                </div>
              }
              onPaste={onPaste}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <BeautifulMentionsPlugin
          items={mentionItems}
          menuComponent={CustomMenu}
          menuItemComponent={CustomMenuItem}
          creatable={false}
        />
        <OnChangePlugin onChange={handleEditorChange} />
        <HistoryPlugin />
        <EnterKeyPlugin onSubmit={handleSubmit} />
        <ClearEditorPlugin
          shouldClear={shouldClear}
          onCleared={handleCleared}
        />
      </div>
    </LexicalComposer>
  );
}
