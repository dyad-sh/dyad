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

export type RagSourceGroup = {
  source: ChatAgentRagSource;
  locations: ChatAgentRagSource[];
};

export function groupRagSources(
  sources: ChatAgentRagSource[],
): RagSourceGroup[] {
  const groups = new Map<string, RagSourceGroup>();

  for (const source of sources) {
    const key = `${source.collectionId}:${source.sourceId}:${source.sourcePath}`;
    const existing = groups.get(key);
    if (existing) {
      existing.locations.push(source);
    } else {
      groups.set(key, { source, locations: [source] });
    }
  }

  return [...groups.values()];
}

function compactPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index];
    }
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }

  return ranges.join(", ");
}

export function ragSourceGroupLocator(locations: ChatAgentRagSource[]): string {
  const pages = locations.flatMap((source) =>
    source.page == null ? [] : [source.page],
  );
  if (pages.length > 0) {
    const uniquePages = [...new Set(pages)];
    return `${uniquePages.length === 1 ? "Page" : "Pages"} ${compactPageList(uniquePages)}`;
  }

  const locators = [...new Set(locations.map(ragSourceLocator))];
  return locators.join(", ");
}

function RagSourceLink({ group }: { group: RagSourceGroup }) {
  const [missing, setMissing] = useState(false);
  const { source, locations } = group;
  const locator = ragSourceGroupLocator(locations);

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
  const groups = groupRagSources(sources);

  return (
    <section
      className="chat-rag-sources chat-card-fly-in"
      aria-label="Sources consulted"
    >
      <div className="chat-rag-sources-heading">Sources consulted</div>
      <div className="chat-rag-source-list">
        {groups.map((group) => (
          <RagSourceLink
            key={`${group.source.collectionId}:${group.source.sourceId}:${group.source.sourcePath}`}
            group={group}
          />
        ))}
      </div>
    </section>
  );
}
