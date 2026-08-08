import React, { useState, useEffect, memo, type ReactNode } from "react";
import ShikiHighlighter, {
  isInlineCode,
  createHighlighterCore,
  createJavaScriptRegexEngine,
} from "react-shiki/core";
import type { Element as HastElement } from "hast";
import { useTheme } from "../../contexts/ThemeContext";
import { PLAN_ANNOTATION_IGNORE_ATTRIBUTE } from "../preview_panel/plan/planAnnotationDom";
import { Copy, Check, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  // Force the dark Shiki theme regardless of the app's light/dark setting.
  // Used by always-dark surfaces (e.g. the Chat Agent HUD) so code blocks
  // don't render a light theme on a dark background.
  forceDark?: boolean | undefined;
  // Show a "Preview" button on renderable (HTML/SVG) blocks that opens a
  // sandboxed live preview in a modal.
  enablePreview?: boolean | undefined;
}

// Languages whose source can be rendered as a live HTML preview.
const PREVIEWABLE_LANGUAGES = new Set(["html", "svg", "xml"]);

export const CodeHighlight = memo(
  ({
    className,
    children,
    node,
    forceDark,
    enablePreview,
    ...props
  }: CodeHighlightProps) => {
    const code = String(children).trim();
    const language = className?.match(/language-(\w+)/)?.[1];
    const isInline = node ? isInlineCode(node) : false;
    //handle copying code to clipboard with transition effect
    const [copied, setCopied] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // revert after 2s
    };

    const isPreviewable =
      !!enablePreview && !!language && PREVIEWABLE_LANGUAGES.has(language);

    const { isDarkMode } = useTheme();
    const useDarkTheme = forceDark || isDarkMode;
    const highlighter = useHighlighter();

    return !isInline ? (
      <div
        className="shiki not-prose relative [&_pre]:overflow-auto 
      [&_pre]:rounded-lg [&_pre]:px-6 [&_pre]:py-7"
      >
        {code && (
          <div
            {...{ [PLAN_ANNOTATION_IGNORE_ATTRIBUTE]: true }}
            className="absolute top-2 left-0 right-0 px-6 text-xs z-10 flex items-center justify-between"
          >
            {language && (
              <span className="tracking-tighter text-muted-foreground/85 truncate min-w-0">
                {language}
              </span>
            )}
            <div className="ml-auto flex flex-shrink-0 items-center gap-3">
              {isPreviewable && (
                <button
                  className="flex items-center text-xs cursor-pointer"
                  onClick={() => setPreviewOpen(true)}
                  type="button"
                >
                  <Eye size={14} />
                  <span className="ml-1">Preview</span>
                </button>
              )}
              <button
                className="flex items-center text-xs cursor-pointer"
                onClick={handleCopy}
                type="button"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
        )}
        {isPreviewable && (
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="w-[92vw] max-w-5xl gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b px-4 py-3">
                <DialogTitle className="text-sm">
                  Preview{language ? ` · ${language}` : ""}
                </DialogTitle>
              </DialogHeader>
              {/* Sandboxed (no allow-same-origin) so previewed markup can't
                  reach the app. Scripts run in an opaque origin. */}
              <iframe
                title="Code preview"
                srcDoc={code}
                sandbox="allow-scripts allow-modals allow-popups"
                className="h-[72vh] w-full border-0 bg-white"
              />
            </DialogContent>
          </Dialog>
        )}
        {highlighter ? (
          <ShikiHighlighter
            highlighter={highlighter}
            language={language}
            theme={
              useDarkTheme ? "github-dark-default" : "github-light-default"
            }
            delay={150}
            showLanguage={false}
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
