import { useEffect, useRef, useCallback } from "react";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_TAB_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { usePostHog } from "posthog-js/react";
import { ipc } from "@/ipc/types";

interface AutocompletePluginProps {
  chatId?: number;
  appId?: number | null;
}

export function AutocompletePlugin({ chatId, appId }: AutocompletePluginProps) {
  const [editor] = useLexicalComposerContext();
  const posthog = usePostHog();

  const suggestionRef = useRef("");
  const variantIdRef = useRef("");
  const requestIdRef = useRef("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostSpanRef = useRef<HTMLSpanElement | null>(null);

  const clearGhostText = useCallback(() => {
    if (ghostSpanRef.current) {
      ghostSpanRef.current.remove();
      ghostSpanRef.current = null;
    }
  }, []);

  const showGhostText = useCallback(
    (text: string) => {
      clearGhostText();

      const rootElement = editor.getRootElement();
      if (!rootElement) return;

      // Find the selection anchor in the DOM
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const range = domSelection.getRangeAt(0);
      if (!rootElement.contains(range.endContainer)) return;

      const span = document.createElement("span");
      span.textContent = text;
      span.className = "autocomplete-ghost-text";
      span.style.cssText =
        "color: var(--muted-foreground); opacity: 0.4; pointer-events: none; user-select: none;";
      span.setAttribute("data-autocomplete-ghost", "true");

      // Insert after the current cursor position
      range.collapse(false);
      range.insertNode(span);

      // Move selection back before the ghost span so typing replaces it naturally
      const newRange = document.createRange();
      newRange.setStartBefore(span);
      newRange.collapse(true);
      domSelection.removeAllRanges();
      domSelection.addRange(newRange);

      ghostSpanRef.current = span;
    },
    [editor, clearGhostText],
  );

  // Tab key handler — accept suggestion
  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        if (!suggestionRef.current) {
          return false;
        }

        event.preventDefault();

        const textToInsert = suggestionRef.current;
        const variant = variantIdRef.current;

        // Clear ghost text before inserting
        clearGhostText();

        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(textToInsert);
          }
        });

        posthog.capture("autocomplete:accepted", {
          variantId: variant,
          suggestionLength: textToInsert.length,
        });

        suggestionRef.current = "";
        variantIdRef.current = "";
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, posthog, clearGhostText]);

  // Debounced autocomplete on text changes
  useEffect(() => {
    return editor.registerUpdateListener(({ tags }) => {
      // Skip updates triggered by collaboration or history (undo/redo)
      if (tags.has("collaboration") || tags.has("historic")) return;

      // Dismiss existing suggestion
      if (suggestionRef.current) {
        posthog.capture("autocomplete:dismissed", {
          variantId: variantIdRef.current,
        });
        suggestionRef.current = "";
        variantIdRef.current = "";
      }

      clearGhostText();

      // Cancel pending request
      if (requestIdRef.current) {
        ipc.autocomplete.cancelSuggestion(requestIdRef.current).catch(() => {});
        requestIdRef.current = "";
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const text = editor.getEditorState().read(() => {
        return $getRoot().getTextContent();
      });

      // Don't autocomplete for short inputs
      if (text.trim().length < 5) return;

      // Don't autocomplete if mentions menu is open
      const mentionsMenu = document.querySelector(
        '[data-mentions-menu="true"]',
      );
      if (mentionsMenu && mentionsMenu.children.length > 0) return;

      debounceTimerRef.current = setTimeout(async () => {
        const newRequestId = crypto.randomUUID();
        requestIdRef.current = newRequestId;

        try {
          const response = await ipc.autocomplete.getSuggestion({
            inputText: text,
            chatId,
            appId: appId ?? undefined,
            requestId: newRequestId,
          });

          // Check if still relevant
          if (response.requestId !== requestIdRef.current) return;
          if (!response.suggestion) return;

          suggestionRef.current = response.suggestion;
          variantIdRef.current = response.variantId;

          showGhostText(response.suggestion);

          posthog.capture("autocomplete:shown", {
            variantId: response.variantId,
            inputLength: text.length,
          });
        } catch {
          // Silently ignore — autocomplete is best-effort
        }
      }, 500);
    });
  }, [editor, chatId, appId, posthog, clearGhostText, showGhostText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearGhostText();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (requestIdRef.current) {
        ipc.autocomplete.cancelSuggestion(requestIdRef.current).catch(() => {});
      }
    };
  }, [clearGhostText]);

  return null;
}
