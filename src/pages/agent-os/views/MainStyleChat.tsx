import type { ComponentProps } from "react";
import { Bot, Check, Copy, SendHorizontalIcon, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeHighlight } from "@/components/chat/CodeHighlight";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";
import type { Agent } from "../data";
import type { useAgentChat } from "../useAgentChat";

// Mirrors the app's main chat message typography.
const PROSE =
  "prose prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none break-words text-[15px]";

// Same markdown rendering as the main chat, but code blocks are forced to the
// dark Shiki theme so they stay on-scheme with the holographic Agent OS pages.
const MARKDOWN_COMPONENTS = {
  code: (props: ComponentProps<typeof CodeHighlight>) => (
    <CodeHighlight {...props} forceDark />
  ),
};

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}

/** A single message rendered in the app's main-chat style. */
function MainMessage({
  role,
  content,
  error,
  model,
}: {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  model?: string;
}) {
  const { copyMessageContent, copied } = useCopyToClipboard();

  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="group mx-auto mt-2 w-full max-w-3xl">
          {/* --sidebar-accent (dark) */}
          <div className="ml-24 rounded-lg bg-[#0a2a3a] p-2">
            <div className={PROSE}>
              <Markdown content={content} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="group mx-auto mt-2 w-full max-w-3xl">
        <div className="rounded-lg p-2">
          {error ? (
            <div className={cn(PROSE, "text-rose-300")}>
              <p>{content}</p>
            </div>
          ) : (
            <div className={PROSE}>
              <Markdown content={content} />
            </div>
          )}
          {!error && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => copyMessageContent(content)}
                aria-label="Copy"
                className="flex items-center gap-1 rounded px-2 py-1 text-[#7aadb8] transition-colors hover:bg-white/5 hover:text-white"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              {model && (
                <div className="flex items-center gap-1 text-[#7aadb8]">
                  <Bot className="h-4 w-4 flex-shrink-0" />
                  <span>{model}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Agent OS chat rendered to look like the app's main chat: a centered prose
 * column, accent-boxed user turns, full-width assistant markdown, and the
 * rounded-2xl composer. Used for Hermes and OpenClaw agents.
 */
export function MainStyleChat({
  agents,
  activeId,
  agent,
  onSelectAgent,
  chat,
}: {
  agents: Agent[];
  activeId: string;
  agent?: Agent;
  onSelectAgent: (id: string) => void;
  chat: ReturnType<typeof useAgentChat>;
}) {
  const { messages, input, setInput, streaming, streamingText, send, stop } =
    chat;
  const empty = messages.length === 0 && !streaming;

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[440px] flex-col">
      {/* Slim header (agent picker) */}
      <div className="mb-1 flex items-center gap-2 border-b border-white/5 px-1 pb-2">
        <span className="grid size-7 place-items-center rounded-lg bg-cyan-500/15 text-cyan-200">
          <Bot className="size-4" />
        </span>
        <select
          value={activeId}
          onChange={(e) => onSelectAgent(e.target.value)}
          disabled={streaming}
          className="rounded-md bg-transparent py-1 text-sm font-medium text-white outline-none disabled:opacity-60"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#0a1628]">
              {a.icon} {a.name}
            </option>
          ))}
        </select>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[#7aadb8]">
          <span
            className={
              agent?.endpoint
                ? "size-1.5 rounded-full bg-emerald-400"
                : "size-1.5 rounded-full bg-amber-400"
            }
          />
          {agent?.model || "no model"}
        </span>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#7aadb8]">
            Ask {agent?.name ?? "the agent"} anything. Replies stream live from
            its endpoint.
          </div>
        ) : (
          <div className="space-y-1 pb-4">
            {messages.map((m, i) => (
              <MainMessage
                key={i}
                role={m.role}
                content={m.content}
                error={m.error}
                model={agent?.model}
              />
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="mx-auto mt-2 w-full max-w-3xl">
                  <div className="rounded-lg p-2">
                    {streamingText ? (
                      <div className={PROSE}>
                        <Markdown content={streamingText} />
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-sm text-[#7aadb8]">
                        <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
                        {agent?.name ?? "Agent"} is thinking…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer (main-chat style) */}
      <div className="mx-auto w-full max-w-3xl px-1 pt-2">
        <div className="relative flex items-end gap-1 rounded-2xl border border-[rgba(0,229,255,0.15)] bg-[#0a1628] p-2 transition-colors duration-200 focus-within:border-cyan-400/40 focus-within:ring-1 focus-within:ring-cyan-400/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={
              streaming
                ? "Streaming response…"
                : `Message ${agent?.name ?? "agent"}…`
            }
            disabled={streaming}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-white outline-none placeholder:text-[#7aadb8] disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              title="Stop generating"
              className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              aria-label="Send"
              className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendHorizontalIcon className="size-4" />
            </button>
          )}
        </div>
        <p className="px-1 pt-1.5 text-center text-[11px] text-[#7aadb8]/70">
          {agent?.name} responds from its configured endpoint · Enter to send
        </p>
      </div>
    </div>
  );
}
