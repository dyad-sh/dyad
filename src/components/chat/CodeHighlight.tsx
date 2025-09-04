import React, {
  useState,
  useEffect,
  useRef,
  memo,
  type ReactNode,
} from "react";
import { isInlineCode, useShikiHighlighter } from "react-shiki";
import github from "@shikijs/themes/github-light-default";
import githubDark from "@shikijs/themes/github-dark-default";
import type { Element as HastElement } from "hast";
import { useTheme } from "../../contexts/ThemeContext";
import { Copy, Check } from "lucide-react";

interface CodeHighlightProps {
  className?: string | undefined;
  children?: ReactNode | undefined;
  node?: HastElement | undefined;
}

export const CodeHighlight = memo(
  ({ className, children, node, ...props }: CodeHighlightProps) => {
    const code = String(children).trim();
    const language = className?.match(/language-(\w+)/)?.[1];
    const isInline = node ? isInlineCode(node) : false;
    //handle copying code to clipboard with transition effect
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // revert after 2s
    };

    const { isDarkMode } = useTheme();

    // Cache for the highlighted code
    const highlightedCodeCache = useRef<ReactNode | null>(null);

    // Only update the highlighted code if the inputs change
    const highlightedCode = useShikiHighlighter(
      code,
      language,
      isDarkMode ? githubDark : github,
      {
        delay: 150,
      },
    );

    // Update the cache whenever we get a new highlighted code
    useEffect(() => {
      if (highlightedCode) {
        highlightedCodeCache.current = highlightedCode;
      }
    }, [highlightedCode]);

    // Use the cached version during transitions to prevent flickering
    const displayedCode = highlightedCode || highlightedCodeCache.current;
    return !isInline ? (
      <div
        className="shiki not-prose relative [&_pre]:overflow-auto 
      [&_pre]:rounded-lg [&_pre]:px-6 [&_pre]:py-7"
      >
        {language ? (
          <div className="absolute top-2 left-2 right-2 text-xs flex justify-between">
            <span className="tracking-tighter text-muted-foreground/85">
              {language}
            </span>
            {code && (
              <button
                className="mr-2 flex items-center text-xs cursor-pointer"
                onClick={handleCopy}
                type="button"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
              </button>
            )}
          </div>
        ) : null}
        {displayedCode}
      </div>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.children === nextProps.children;
  },
);
