import React, { useState, useEffect, memo, type ReactNode } from "react";
import ShikiHighlighter, {
  isInlineCode,
  createHighlighterCore,
  createJavaScriptRegexEngine,
} from "react-shiki/core";
import type { Element as HastElement } from "hast";
import { useTheme } from "../../contexts/ThemeContext";
import { Copy, Check } from "lucide-react";
import github from "@shikijs/themes/github-light-default";
import githubDark from "@shikijs/themes/github-dark-default";
// common languages
import astro from "@shikijs/langs/astro";
import css from "@shikijs/langs/css";
import graphql from "@shikijs/langs/graphql";
import html from "@shikijs/langs/html";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import less from "@shikijs/langs/less";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import sass from "@shikijs/langs/sass";
import scss from "@shikijs/langs/scss";
import shell from "@shikijs/langs/shell";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import vue from "@shikijs/langs/vue";

type HighlighterCore = Awaited<ReturnType<typeof createHighlighterCore>>;

// Create a singleton highlighter instance
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [github, githubDark],
      langs: [
        astro,
        css,
        graphql,
        html,
        java,
        javascript,
        json,
        jsx,
        less,
        markdown,
        python,
        sass,
        scss,
        shell,
        sql,
        tsx,
        typescript,
        vue,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise as Promise<HighlighterCore>;
}

function useHighlighter() {
  const [highlighter, setHighlighter] = useState<HighlighterCore>();

  useEffect(() => {
    getHighlighter().then(setHighlighter);
  }, []);

  return highlighter;
}

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
    const highlighter = useHighlighter();

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
        {highlighter ? (
          <ShikiHighlighter
            highlighter={highlighter}
            language={language}
            theme={isDarkMode ? "github-dark-default" : "github-light-default"}
            delay={150}
          >
            {code}
          </ShikiHighlighter>
        ) : (
          <pre>
            <code>{code}</code>
          </pre>
        )}
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
