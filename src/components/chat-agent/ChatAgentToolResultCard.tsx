import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import type { ChatAgentToolResult } from "./types";

const MAX_VISIBLE_FIELDS = 10;
const MAX_VISIBLE_ITEMS = 6;

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseResult(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function compactValue(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") {
    return /^[a-z]+(?:[_-][a-z]+)*$/.test(value) ? humanize(value) : value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) {
    return value.join(" · ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ResultValue({ value }: { value: unknown }) {
  const text = compactValue(value);
  if (isExternalUrl(value)) {
    return (
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 truncate text-left text-cyan-300 transition-colors hover:text-cyan-100"
        onClick={() => void ipc.system.openExternalUrl(value)}
      >
        <span className="truncate">{value}</span>
        <ExternalLink className="size-3.5 shrink-0" />
      </button>
    );
  }
  return (
    <span className="line-clamp-3 break-words text-sm text-foreground/85">
      {text}
    </span>
  );
}

function ObjectFields({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).slice(0, MAX_VISIBLE_FIELDS);
  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
      {entries.map(([key, fieldValue]) => (
        <div key={key} className="min-w-0">
          <dt className="mb-1 text-[0.68rem] font-semibold tracking-[0.08em] text-cyan-300/55 uppercase">
            {humanize(key)}
          </dt>
          <dd className="min-w-0">
            <ResultValue value={fieldValue} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResultContent({ result }: { result: string }) {
  const parsed = parseResult(result);
  if (Array.isArray(parsed)) {
    return (
      <div className="space-y-2">
        {parsed.slice(0, MAX_VISIBLE_ITEMS).map((item, index) => (
          <div
            key={index}
            className="rounded-xl border border-cyan-400/10 bg-cyan-400/4 p-3"
          >
            {item && typeof item === "object" && !Array.isArray(item) ? (
              <ObjectFields value={item as Record<string, unknown>} />
            ) : (
              <ResultValue value={item} />
            )}
          </div>
        ))}
        {parsed.length > MAX_VISIBLE_ITEMS ? (
          <p className="text-xs text-muted-foreground">
            +{parsed.length - MAX_VISIBLE_ITEMS} more results
          </p>
        ) : null}
      </div>
    );
  }
  if (parsed && typeof parsed === "object") {
    return <ObjectFields value={parsed as Record<string, unknown>} />;
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
      {String(parsed)}
    </p>
  );
}

function toolKind(serverName: string) {
  if (
    [
      "Travel Search",
      "DuckDuckGo",
      "CoinGecko",
      "Open-Meteo",
      "OpenFreeMap",
      "Skyscanner",
      "Amadeus",
      "Duffel Sandbox",
    ].includes(serverName)
  ) {
    return "Plugin";
  }
  return serverName === "System Access" ? "System tool" : "MCP tool";
}

export function ChatAgentToolResultCard({
  result,
}: {
  result: ChatAgentToolResult;
}) {
  const isError = result.status === "error";
  const isRunning = result.status === "running";

  return (
    <section
      className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/18 bg-[#06111f]/82 shadow-[0_12px_34px_rgba(0,0,0,0.2)]"
      data-status={result.status}
    >
      <header
        className={
          isError
            ? "flex items-center gap-3 border-b border-red-400/15 bg-red-400/6 px-4 py-3"
            : "flex items-center gap-3 border-b border-cyan-400/12 bg-cyan-400/5 px-4 py-3"
        }
      >
        <span
          className={
            isError
              ? "grid size-9 shrink-0 place-items-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-300"
              : "grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/9 text-cyan-300"
          }
        >
          {isError ? (
            <XCircle className="size-4.5" />
          ) : isRunning ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {humanize(result.toolName)}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {result.serverName} · {toolKind(result.serverName)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/15 bg-cyan-400/6 px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.08em] text-cyan-200/75 uppercase">
          <Wrench className="size-3" />
          {isError ? "Failed" : isRunning ? "Running" : "Complete"}
        </span>
      </header>

      <div className="p-4">
        <ResultContent result={result.result} />
      </div>

      <details className="group border-t border-cyan-400/10">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-cyan-400/4 hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          View raw response
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-cyan-400/8 bg-black/20 p-4 font-mono text-[0.72rem] leading-5 whitespace-pre-wrap text-cyan-50/70">
          {result.result}
        </pre>
      </details>
    </section>
  );
}
