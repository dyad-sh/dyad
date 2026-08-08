import type { ChatAgentRagSource } from "@/ipc/types/chat_agent";

type RetrievedPassage = {
  collectionId: string;
  collectionName: string;
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  page?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
};

/**
 * Preserve the exact locations retrieval used while removing duplicate chunks
 * from the same page/line range. The ordering remains retrieval order so the
 * strongest source is shown first in the answer.
 */
export function collectRagSources(
  passages: RetrievedPassage[],
): ChatAgentRagSource[] {
  const seen = new Set<string>();
  const sources: ChatAgentRagSource[] = [];

  for (const passage of passages) {
    const page = passage.page ?? null;
    const lineStart = page == null ? (passage.lineStart ?? null) : null;
    const lineEnd = page == null ? (passage.lineEnd ?? null) : null;
    const key = [
      passage.collectionId,
      passage.sourceId,
      page ?? "",
      lineStart ?? "",
      lineEnd ?? "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      collectionId: passage.collectionId,
      collectionName: passage.collectionName,
      sourceId: passage.sourceId,
      sourceName: passage.sourceName,
      sourcePath: passage.sourcePath,
      page,
      lineStart,
      lineEnd,
    });
  }

  return sources;
}

const MARKDOWN_LINK = /\[([^\]]+)]\([^)]+\)/g;
const DASHES = /[‐‑‒–—−]/g;

function normalizeCitationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(MARKDOWN_LINK, "$1")
    .replace(DASHES, "-")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

type CitedRange = { start: number; end: number };

function citedRanges(value: string): CitedRange[] {
  const ranges: CitedRange[] = [];
  const tokens = value
    .replace(/\b(?:and|to)\b|&/g, ",")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const second = Number(range[2]);
      ranges.push({
        start: Math.min(first, second),
        end: Math.max(first, second),
      });
      continue;
    }
    const single = Number(token);
    if (Number.isInteger(single)) ranges.push({ start: single, end: single });
  }

  return ranges;
}

function sourceLocationWasCited(
  normalizedAnswer: string,
  source: ChatAgentRagSource,
  knownSourceNames: string[],
): boolean {
  const normalizedName = normalizeCitationText(source.sourceName);
  let searchFrom = 0;

  while (searchFrom < normalizedAnswer.length) {
    const nameIndex = normalizedAnswer.indexOf(normalizedName, searchFrom);
    if (nameIndex === -1) return false;
    searchFrom = nameIndex + normalizedName.length;

    const belongsToLongerSourceName = knownSourceNames.some((otherName) => {
      if (otherName.length <= normalizedName.length) return false;
      const offset = otherName.indexOf(normalizedName);
      if (offset === -1) return false;
      const otherStart = nameIndex - offset;
      return (
        otherStart >= 0 &&
        normalizedAnswer.slice(otherStart, otherStart + otherName.length) ===
          otherName
      );
    });
    if (belongsToLongerSourceName) continue;

    // The required citation format places the locator immediately after the
    // file name. Keeping this window tight prevents a page belonging to the
    // next source in the list from being attributed to this one.
    const following = normalizedAnswer.slice(searchFrom, searchFrom + 120);
    const locator = following.match(
      /^[\s()[\]{},.;:·-]*(?:at\s+)?(pages?|lines?)\s+(\d+(?:\s*(?:,|&|and|to|-)\s*\d+)*)/,
    );

    if (source.page == null && source.lineStart == null) return true;
    if (!locator) continue;

    const kind = locator[1];
    const ranges = citedRanges(locator[2]);
    if (source.page != null && kind.startsWith("page")) {
      if (
        ranges.some(
          (range) => source.page! >= range.start && source.page! <= range.end,
        )
      ) {
        return true;
      }
    }

    if (
      source.page == null &&
      source.lineStart != null &&
      source.lineEnd != null &&
      kind.startsWith("line") &&
      ranges.some(
        (range) =>
          range.end >= source.lineStart! && range.start <= source.lineEnd!,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Keeps only the retrieved locations the final answer actually cited.
 * Retrieval can inspect several nearby documents; those are candidates, not
 * automatically sources used in the response.
 */
export function selectCitedRagSources(
  answer: string,
  sources: ChatAgentRagSource[],
): ChatAgentRagSource[] {
  if (!answer.trim() || sources.length === 0) return [];
  const normalizedAnswer = normalizeCitationText(answer);
  const knownSourceNames = sources.map((source) =>
    normalizeCitationText(source.sourceName),
  );
  return sources.filter((source) =>
    sourceLocationWasCited(normalizedAnswer, source, knownSourceNames),
  );
}
