import React, { useEffect, useRef, memo, type ReactNode } from "react";
import { isInlineCode, useShikiHighlighter } from "react-shiki";
import github from "@shikijs/themes/github-light-default";
import githubDark from "@shikijs/themes/github-dark-default";
import type { Element as HastElement } from "hast";
import { useTheme } from "../../contexts/ThemeContext";

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
      [&_pre]:rounded-lg [&_pre]:px-6 [&_pre]:py-5"
      >
        {language ? (
          <span
            className="absolute right-3 top-2 text-xs tracking-tighter
          text-muted-foreground/85"
          >
            {language}
          </span>
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
