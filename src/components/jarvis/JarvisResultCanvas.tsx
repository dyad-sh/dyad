import {
  AlertTriangle,
  Compass,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Search,
  Settings2,
  ShieldQuestion,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A structured result produced by Meta Human OS. Result cards keep the workspace
 * readable — answers, images and tool outcomes each get their own shape
 * rather than a wall of chat bubbles.
 */
export type JarvisResultCard =
  | { kind: "answer"; id: string; text: string; isStreaming?: boolean }
  | { kind: "navigation"; id: string; title: string; detail?: string }
  | { kind: "image"; id: string; title: string; src: string }
  | {
      kind: "code";
      id: string;
      title: string;
      filesChanged: string[];
      buildStatus?: "passed" | "failed" | "not run";
      testsSummary?: string;
      summary: string;
      onOpen?: () => void;
    }
  | {
      kind: "search";
      id: string;
      title: string;
      results: { label: string; detail?: string }[];
    }
  | { kind: "settings"; id: string; title: string; detail?: string }
  | { kind: "tool"; id: string; title: string; detail?: string }
  | { kind: "error"; id: string; title: string; detail?: string }
  | {
      kind: "confirmation";
      id: string;
      message: string;
      onApprove: () => void;
      onDecline: () => void;
    };

const CARD_ICONS: Record<JarvisResultCard["kind"], LucideIcon> = {
  answer: MessageSquare,
  navigation: Compass,
  image: ImageIcon,
  code: FileText,
  search: Search,
  settings: Settings2,
  tool: Terminal,
  error: AlertTriangle,
  confirmation: ShieldQuestion,
};

function CardShell({
  kind,
  title,
  children,
  tone = "default",
}: {
  kind: JarvisResultCard["kind"];
  title: string;
  children?: React.ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  const Icon = CARD_ICONS[kind];
  return (
    <article
      className={cn(
        "jarvis-panel rounded-xl px-4 py-3",
        tone === "warning" && "border-amber-400/30",
        tone === "danger" && "border-rose-400/30",
      )}
    >
      <header className="flex items-center gap-2">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "default" && "text-cyan-300/70",
            tone === "warning" && "text-amber-300/80",
            tone === "danger" && "text-rose-300/80",
          )}
        />
        <h3 className="font-jarvis-ui text-[11px] tracking-widest text-cyan-200/70 uppercase">
          {title}
        </h3>
      </header>
      {children && <div className="mt-2">{children}</div>}
    </article>
  );
}

function ResultCard({ card }: { card: JarvisResultCard }) {
  switch (card.kind) {
    case "answer":
      return (
        <article className="jarvis-panel rounded-xl px-4 py-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-cyan-50/90">
            {card.text}
            {card.isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-cyan-300/70 align-text-bottom" />
            )}
          </p>
        </article>
      );

    case "navigation":
      return (
        <CardShell kind="navigation" title="Navigation">
          <p className="text-sm text-cyan-50/85">{card.title}</p>
          {card.detail && (
            <p className="mt-1 text-xs text-cyan-100/45">{card.detail}</p>
          )}
        </CardShell>
      );

    case "image":
      return (
        <CardShell kind="image" title="Image generated">
          <img
            src={card.src}
            alt={card.title}
            className="w-full rounded-lg border border-cyan-400/15"
          />
          <p className="mt-2 text-xs text-cyan-100/50">{card.title}</p>
        </CardShell>
      );

    case "code":
      return (
        <CardShell kind="code" title="Code task">
          <p className="text-sm text-cyan-50/85">{card.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-cyan-100/50">
            {card.summary}
          </p>
          {card.filesChanged.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {card.filesChanged.slice(0, 6).map((file) => (
                <li
                  key={file}
                  className="truncate font-mono text-[11px] text-cyan-200/60"
                >
                  {file}
                </li>
              ))}
              {card.filesChanged.length > 6 && (
                <li className="text-[11px] text-cyan-100/35">
                  and {card.filesChanged.length - 6} more
                </li>
              )}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            {card.buildStatus && (
              <span
                className={cn(
                  card.buildStatus === "passed" && "text-emerald-300/80",
                  card.buildStatus === "failed" && "text-rose-300/80",
                  card.buildStatus === "not run" && "text-cyan-100/40",
                )}
              >
                Build: {card.buildStatus}
              </span>
            )}
            {card.testsSummary && (
              <span className="text-cyan-100/50">{card.testsSummary}</span>
            )}
            {card.onOpen && (
              <button
                type="button"
                onClick={card.onOpen}
                className="ml-auto rounded border border-cyan-400/25 px-2 py-1 text-cyan-200/80 hover:bg-cyan-400/10 focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
              >
                Open in editor
              </button>
            )}
          </div>
        </CardShell>
      );

    case "search":
      return (
        <CardShell kind="search" title="Search completed">
          <p className="text-sm text-cyan-50/85">{card.title}</p>
          <ul className="mt-2 space-y-1">
            {card.results.map((result) => (
              <li key={result.label} className="text-xs text-cyan-100/60">
                <span className="text-cyan-50/80">{result.label}</span>
                {result.detail && (
                  <span className="ml-2 text-cyan-100/40">{result.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </CardShell>
      );

    case "settings":
      return (
        <CardShell kind="settings" title="Settings changed">
          <p className="text-sm text-cyan-50/85">{card.title}</p>
          {card.detail && (
            <p className="mt-1 text-xs text-cyan-100/45">{card.detail}</p>
          )}
        </CardShell>
      );

    case "tool":
      return (
        <CardShell kind="tool" title="Tool result">
          <p className="text-sm text-cyan-50/85">{card.title}</p>
          {card.detail && (
            <p className="mt-1 text-xs text-cyan-100/45">{card.detail}</p>
          )}
        </CardShell>
      );

    case "error":
      return (
        <CardShell kind="error" title="Error" tone="danger">
          <p className="text-sm text-rose-100/85">{card.title}</p>
          {card.detail && (
            <p className="mt-1 text-xs text-rose-100/50">{card.detail}</p>
          )}
        </CardShell>
      );

    case "confirmation":
      return (
        <CardShell kind="confirmation" title="Approval required" tone="warning">
          <p className="text-sm text-amber-50/90">{card.message}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={card.onApprove}
              className="rounded border border-amber-400/40 px-3 py-1 text-xs text-amber-100 hover:bg-amber-400/10 focus-visible:ring-1 focus-visible:ring-amber-400/60 focus-visible:outline-none"
            >
              Yes, continue
            </button>
            <button
              type="button"
              onClick={card.onDecline}
              className="rounded border border-cyan-400/25 px-3 py-1 text-xs text-cyan-100/80 hover:bg-cyan-400/10 focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
        </CardShell>
      );
  }
}

export function JarvisResultCanvas({
  cards,
  emptyHint,
}: {
  cards: JarvisResultCard[];
  emptyHint: string;
}) {
  if (cards.length === 0) {
    return (
      <div className="jarvis-panel flex min-h-40 items-center justify-center rounded-xl px-6 py-10">
        <p className="max-w-sm text-center text-sm text-cyan-100/40">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <ResultCard key={card.id} card={card} />
      ))}
    </div>
  );
}
