import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

export interface RichTextEditorHandle {
  getText: () => string;
  getHTML: () => string;
  focus: () => void;
  execCommand: (command: string, value?: string) => void;
}

interface RichTextEditorProps {
  initialText: string;
  onChange?: (text: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * A simple contenteditable-based rich text editor.
 * Uses the browser's built-in execCommand for formatting (bold, italic, etc.)
 * which gives us zero-dep rich text that integrates perfectly with Electron.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  ({ initialText, onChange, className, placeholder = "Start typing…" }, ref) => {
    const divRef = useRef<HTMLDivElement>(null);
    const isInitialized = useRef(false);

    // Convert plain text to simple HTML for display
    const textToHtml = useCallback((text: string): string => {
      return text
        .split("\n\n")
        .map((para) => {
          if (para.startsWith("# ")) return `<h1>${para.slice(2)}</h1>`;
          if (para.startsWith("## ")) return `<h2>${para.slice(3)}</h2>`;
          if (para.startsWith("### ")) return `<h3>${para.slice(4)}</h3>`;
          const lines = para.split("\n");
          if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
            const items = lines.map((l) => `<li>${l.slice(2)}</li>`).join("");
            return `<ul>${items}</ul>`;
          }
          if (lines.every((l) => /^\d+\.\s/.test(l))) {
            const items = lines.map((l) => `<li>${l.replace(/^\d+\.\s/, "")}</li>`).join("");
            return `<ol>${items}</ol>`;
          }
          return `<p>${para.replace(/\n/g, "<br>")}</p>`;
        })
        .join("");
    }, []);

    // Convert HTML back to plain text / simple markdown
    const htmlToText = useCallback((el: HTMLDivElement): string => {
      const lines: string[] = [];
      el.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          lines.push(node.textContent || "");
        } else if (node instanceof HTMLElement) {
          const tag = node.tagName.toLowerCase();
          if (tag === "h1") lines.push(`# ${node.textContent}`);
          else if (tag === "h2") lines.push(`## ${node.textContent}`);
          else if (tag === "h3") lines.push(`### ${node.textContent}`);
          else if (tag === "ul") {
            node.querySelectorAll("li").forEach((li) => lines.push(`- ${li.textContent}`));
          } else if (tag === "ol") {
            let n = 1;
            node.querySelectorAll("li").forEach((li) => {
              lines.push(`${n++}. ${li.textContent}`);
            });
          } else {
            lines.push(node.textContent || "");
          }
        }
      });
      return lines.join("\n\n");
    }, []);

    useEffect(() => {
      if (!divRef.current || isInitialized.current) return;
      divRef.current.innerHTML = textToHtml(initialText);
      isInitialized.current = true;
    }, [initialText, textToHtml]);

    const handleInput = useCallback(() => {
      if (!divRef.current || !onChange) return;
      onChange(htmlToText(divRef.current));
    }, [onChange, htmlToText]);

    useImperativeHandle(ref, () => ({
      getText: () => (divRef.current ? htmlToText(divRef.current) : ""),
      getHTML: () => divRef.current?.innerHTML ?? "",
      focus: () => divRef.current?.focus(),
      execCommand: (command: string, value?: string) => {
        divRef.current?.focus();
        document.execCommand(command, false, value);
      },
    }));

    return (
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        spellCheck
        className={cn(
          "min-h-full w-full outline-none text-foreground",
          "prose prose-neutral dark:prose-invert max-w-none",
          "prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
          "[&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-muted-foreground",
          "focus:outline-none",
          className
        )}
      />
    );
  }
);

RichTextEditor.displayName = "RichTextEditor";
