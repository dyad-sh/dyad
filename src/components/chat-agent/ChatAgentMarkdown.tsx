import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitStreamingMarkdown } from "@/lib/streaming_markdown";

import { CodeHighlight } from "../chat/CodeHighlight";
import { Children, useState } from "react";
import { FileText } from "lucide-react";

import { ipc } from "@/ipc/types";
import { splitByCitations, type Citation } from "@/lib/citations";
import { cn } from "@/lib/utils";

// Module-level so ReactMarkdown's prop-equality checks aren't defeated by
// fresh refs on every render.
const REMARK_PLUGINS = [remarkGfm];

/**
 * Renders a run of markdown text, turning citations into buttons that open
 * the cited document. Only the text nodes are touched, so links, code and
 * emphasis inside a paragraph are unaffected.
 */
function withCitations(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const segments = splitByCitations(child);
    if (segments.length === 1 && segments[0].kind === "text") return child;
    return segments.map((segment, index) =>
      segment.kind === "text" ? (
        segment.text
      ) : (
        <CitationChip key={index} citation={segment.citation} />
      ),
    );
  });
}

function CitationChip({ citation }: { citation: Citation }) {
  const [missing, setMissing] = useState(false);

  const open = async () => {
    const result = await ipc.vector.openSourceByName({
      sourceName: citation.sourceName,
      page: citation.page ?? undefined,
      lineStart: citation.lineStart ?? undefined,
      lineEnd: citation.lineEnd ?? undefined,
    });
    // A cited file that is not in the index should say so rather than
    // silently doing nothing.
    if (!result.opened) setMissing(true);
  };

  return (
    <button
      type="button"
      className={cn("chat-citation", missing && "is-missing")}
      onClick={() => void open()}
      title={
        missing
          ? `${citation.sourceName} is not in the index on this machine`
          : `Open ${citation.sourceName}${citation.locator ? ` at ${citation.locator}` : ""}`
      }
      data-testid="chat-citation"
    >
      <FileText className="size-3" aria-hidden />
      <span className="chat-citation-name">{citation.sourceName}</span>
      {citation.locator && (
        <>
          {/* A real separator: without it the name and locator ran together
              as "…v2.9.pdflines 183–250". */}
          <span className="chat-citation-sep" aria-hidden>
            ·
          </span>
          <span className="chat-citation-locator">{citation.locator}</span>
        </>
      )}
    </button>
  );
}

const MARKDOWN_COMPONENTS = {
  // Force the dark Shiki theme — the Chat Agent surface is always dark.
  // Pass every prop through (incl. `node`) so CodeHighlight can still tell
  // inline code from block code. enablePreview adds a live preview modal for
  // renderable (HTML/SVG) blocks.
  code: (props: any) => <CodeHighlight {...props} forceDark enablePreview />,
  p: ({ node: _node, children, ...props }: any) => (
    <p {...props}>{withCitations(children)}</p>
  ),
  li: ({ node: _node, children, ...props }: any) => (
    <li {...props}>{withCitations(children)}</li>
  ),
  td: ({ node: _node, children, ...props }: any) => (
    <td {...props}>{withCitations(children)}</td>
  ),
  a: ({ node: _node, ...props }: { node?: any; [key: string]: any }) => (
    <a
      {...props}
      onClick={(e) => {
        const url = props.href;
        if (url) {
          e.preventDefault();
          ipc.system.openExternalUrl(url);
        }
      }}
    />
  ),
};

/**
 * A run of markdown rendered on its own.
 *
 * Memoised on its text, which is what lets settled blocks keep their DOM while
 * the reply is still arriving.
 */
const MarkdownRun = memo(function MarkdownRun({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});

/**
 * Renders Chat Agent assistant messages as markdown so fenced code blocks
 * become syntax-highlighted blocks (with a language label + copy button)
 * instead of raw text.
 *
 * A streaming reply is split into the blocks that can no longer change and the
 * one still being written. Only the latter re-parses per chunk, so the cost of
 * a flush stays flat instead of growing with the length of the answer.
 */
export function ChatAgentMarkdown({ content }: { content: string }) {
  const { stable, trailing } = splitStreamingMarkdown(content);
  return (
    <div className="chat-agent-markdown">
      {stable && <MarkdownRun text={stable} />}
      {trailing && <MarkdownRun text={trailing} />}
    </div>
  );
}
