import React, { useCallback, useEffect, useState } from "react";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  EditorState,
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
  $createBeautifulMentionNode,
  type BeautifulMentionsTheme,
  type BeautifulMentionsMenuItemProps,
} from "lexical-beautiful-mentions";
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";
import { useLoadApps } from "@/hooks/useLoadApps";
import { forwardRef } from "react";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { MENTION_REGEX, parseAppMentions } from "@/shared/parse_mention_apps";

// Define the theme for mentions
const beautifulMentionsTheme: BeautifulMentionsTheme = {
  "@": "px-2 py-0.5 mx-0.5 bg-accent text-accent-foreground rounded-md",
  "@Focused": "outline-none ring-2 ring-ring",
};

// Custom menu item component
const CustomMenuItem = forwardRef<
  HTMLLIElement,
  BeautifulMentionsMenuItemProps
>(({ selected, item, ...props }, ref) => (
  <li
    className={`m-0 flex items-center px-3 py-2 cursor-pointer whitespace-nowrap ${
      selected
        ? "bg-accent text-accent-foreground"
        : "bg-popover text-popover-foreground hover:bg-accent/50"
    }`}
    {...props}
    ref={ref}
  >
    <div className="flex items-center space-x-2 min-w-0">
      <span className="px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground rounded-md flex-shrink-0">
        App
      </span>
      <span className="truncate text-sm">
        {typeof item === "string" ? item : item.value}
      </span>
    </div>
  </li>
));

// Custom menu component
function CustomMenu({ loading: _loading, ...props }: any) {
  return (
    <ul
      className="m-0 mb-1 min-w-[300px] w-auto max-h-64 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg z-50"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        transform: "translateY(-20px)", // Add a larger gap between menu and input (12px higher)
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

// Plugin to sync external value prop into the editor
function ExternalValueSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Derive the display text that should appear in the editor (@Name) from the
    // internal value representation (@app:Name)
    const displayText = (value || "").replace(MENTION_REGEX, "@$1");

    const currentText = editor.getEditorState().read(() => {
      const root = $getRoot();
      return root.getTextContent();
    });

    // If the editor already reflects the same display text, do nothing to avoid loops
    if (currentText === displayText) return;
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();

      // Build nodes from the internal value, turning @app:Name into a mention node
      const mentionRegex = /@app:([a-zA-Z0-9_-]+)/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = mentionRegex.exec(value)) !== null) {
        const [full, name] = match;
        const start = match.index;

        // Append any text before the mention
        if (start > lastIndex) {
          const textBefore = value.slice(lastIndex, start);
          if (textBefore) paragraph.append($createTextNode(textBefore));
        }

        // Append the actual mention node (@ trigger with value = Name)
        paragraph.append($createBeautifulMentionNode("@", name));

        lastIndex = start + full.length;
      }

      // Append any trailing text after the last mention
      if (lastIndex < value.length) {
        const trailing = value.slice(lastIndex);
        if (trailing) paragraph.append($createTextNode(trailing));
      }

      // If there were no mentions at all, just append the raw value as text
      if (value && paragraph.getTextContent() === "") {
        paragraph.append($createTextNode(value));
      }

      root.append(paragraph);
      paragraph.selectEnd();
    });
  }, [editor, value]);

  return null;
}

interface LexicalChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeCurrentApp: boolean;
}

function onError(error: Error) {
  console.error(error);
}

export function LexicalChatInput({
  value,
  onChange,
  onSubmit,
  onPaste,
  excludeCurrentApp,
  placeholder = "Ask Dyad to build...",
  disabled = false,
}: LexicalChatInputProps) {
  const { apps } = useLoadApps();
  const [shouldClear, setShouldClear] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  // Prepare mention items - convert apps to mention format
  const mentionItems = React.useMemo(() => {
    if (!apps) return { "@": [] };

    // Get current app name
    const currentApp = apps.find((app) => app.id === selectedAppId);
    const currentAppName = currentApp?.name;

    // Parse already mentioned apps from current input value
    const alreadyMentioned = parseAppMentions(value);

    // Filter out current app and already mentioned apps
    const filteredApps = apps.filter((app) => {
      // Exclude current app
      if (excludeCurrentApp && app.name === currentAppName) return false;

      // Exclude already mentioned apps (case-insensitive comparison)
      if (
        alreadyMentioned.some(
          (mentioned) => mentioned.toLowerCase() === app.name.toLowerCase(),
        )
      )
        return false;

      return true;
    });

    const appMentions = filteredApps.map((app) => app.name);
    return {
      "@": appMentions,
    };
  }, [apps, selectedAppId, value, excludeCurrentApp]);

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
        let textContent = root.getTextContent();

        // Transform @AppName mentions to @app:AppName format
        // This regex matches @AppName where AppName is one of our actual app names

        // Short-circuit if there's no "@" symbol in the text
        if (textContent.includes("@")) {
          const appNames = apps?.map((app) => app.name) || [];
          for (const appName of appNames) {
            // Escape special regex characters in app name
            const escapedAppName = appName.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const mentionRegex = new RegExp(
              `@(${escapedAppName})(?![a-zA-Z0-9_-])`,
              "g",
            );
            textContent = textContent.replace(mentionRegex, "@app:$1");
          }
        }
        onChange(textContent);
      });
    },
    [onChange, apps],
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
                <div className="absolute top-2 left-2 text-muted-foreground pointer-events-none select-none">
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
          insertOnBlur={false}
          menuItemLimit={10}
        />
        <OnChangePlugin onChange={handleEditorChange} />
        <HistoryPlugin />
        <EnterKeyPlugin onSubmit={handleSubmit} />
        <ExternalValueSyncPlugin value={value} />
        <ClearEditorPlugin
          shouldClear={shouldClear}
          onCleared={handleCleared}
        />
      </div>
    </LexicalComposer>
  );
}
