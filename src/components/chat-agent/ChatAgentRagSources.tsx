import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";

import { ipc } from "@/ipc/types";
import type { ChatAgentRagSource } from "@/ipc/types/chat_agent";
import { cn } from "@/lib/utils";

export function ragSourceLocator(source: ChatAgentRagSource): string {
  if (source.page != null) return `Page ${source.page}`;
  if (source.lineStart != null && source.lineEnd != null) {
    return `Lines ${source.lineStart}–${source.lineEnd}`;
  }
  return "Indexed document";
}

export function ragSourceFolder(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  const lastSeparator = normalized.lastIndexOf("/");
  return lastSeparator > 0 ? normalized.slice(0, lastSeparator) : normalized;
}

function RagSourceLink({ source }: { source: ChatAgentRagSource }) {
  const [missing, setMissing] = useState(false);
  const locator = ragSourceLocator(source);

  const open = async () => {
    const result = await ipc.vector.openSourceLocation({
      collectionId: source.collectionId,
      sourceId: source.sourceId,
      page: source.page ?? undefined,
      lineStart: source.lineStart ?? undefined,
      lineEnd: source.lineEnd ?? undefined,
    });
    if (!result.opened) setMissing(true);
  };

  return (
    <button
      type="button"
      className={cn("chat-rag-source-link", missing && "is-missing")}
      onClick={() => void open()}
      title={
        missing
          ? `${source.sourceName} is no longer available at ${source.sourcePath}`
          : `Open ${source.sourcePath} at ${locator.toLowerCase()}`
      }
      data-testid="chat-rag-source-link"
    >
      <FileText className="chat-rag-source-icon" aria-hidden />
      <span className="chat-rag-source-copy">
        <span className="chat-rag-source-name">{source.sourceName}</span>
        <span className="chat-rag-source-location">
          {locator}
          <span aria-hidden> · </span>
          {source.collectionName}
        </span>
        <span className="chat-rag-source-path">
          {ragSourceFolder(source.sourcePath)}
        </span>
      </span>
      <ExternalLink className="chat-rag-source-open-icon" aria-hidden />
    </button>
  );
}

export function ChatAgentRagSources({
  sources,
}: {
  sources: ChatAgentRagSource[];
}) {
  if (sources.length === 0) return null;

  return (
    <section
      className="chat-rag-sources chat-card-fly-in"
      aria-label="Sources consulted"
    >
      <div className="chat-rag-sources-heading">Sources consulted</div>
      <div className="chat-rag-source-list">
        {sources.map((source) => (
          <RagSourceLink
            key={`${source.collectionId}:${source.sourceId}:${source.page ?? ""}:${source.lineStart ?? ""}:${source.lineEnd ?? ""}`}
            source={source}
          />
        ))}
      </div>
    </section>
  );
}
