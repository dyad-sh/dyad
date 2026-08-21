import type { ModelMessage } from "ai";

const GIT_CONTEXT_TAG_MARKERS = [
  "<dyad-git-context",
  "</dyad-git-context",
] as const;

/**
 * Removes internal Git-context tag markup without exposing partial tags while
 * model text is streaming. Text between an opening and closing tag is
 * preserved; only the internal markup itself is metadata.
 */
export class GitContextEchoSanitizer {
  private pending = "";

  push(chunk: string): string {
    this.pending += chunk;
    let output = "";

    while (this.pending.length > 0) {
      const markerIndex = findNextMarkerIndex(this.pending);
      if (markerIndex === -1) {
        const heldSuffixLength = getPotentialMarkerSuffixLength(this.pending);
        const emitLength = this.pending.length - heldSuffixLength;
        output += this.pending.slice(0, emitLength);
        this.pending = this.pending.slice(emitLength);
        break;
      }

      output += this.pending.slice(0, markerIndex);
      this.pending = this.pending.slice(markerIndex);

      const tagEndIndex = this.pending.indexOf(">");
      if (tagEndIndex === -1) {
        break;
      }
      this.pending = this.pending.slice(tagEndIndex + 1);
    }

    return output;
  }

  finish(): string {
    const pending = this.pending;
    this.pending = "";
    return startsWithMarker(pending) ||
      startsWithDistinctivePartialMarker(pending)
      ? ""
      : pending;
  }
}

export function stripGitContextEchoes(text: string): string {
  const sanitizer = new GitContextEchoSanitizer();
  return sanitizer.push(text) + sanitizer.finish();
}

export function stripGitContextEchoesFromAssistantMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    if (typeof message.content === "string") {
      return {
        ...message,
        content: stripGitContextEchoes(message.content),
      };
    }

    const content = message.content.map((part) => {
      if (part.type !== "text") {
        return part;
      }
      const text = stripGitContextEchoes(part.text);
      return { ...part, text };
    });

    return { ...message, content };
  });
}

function findNextMarkerIndex(text: string): number {
  const normalized = text.toLowerCase();
  let earliest = -1;
  for (const marker of GIT_CONTEXT_TAG_MARKERS) {
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const index = normalized.indexOf(marker, searchFrom);
      if (index === -1) {
        break;
      }
      if (isTagBoundary(normalized[index + marker.length])) {
        if (earliest === -1 || index < earliest) {
          earliest = index;
        }
        break;
      }
      searchFrom = index + 1;
    }
  }
  return earliest;
}

function getPotentialMarkerSuffixLength(text: string): number {
  const normalized = text.toLowerCase();
  const maxLength = Math.min(
    normalized.length,
    Math.max(...GIT_CONTEXT_TAG_MARKERS.map((marker) => marker.length - 1)),
  );

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = normalized.slice(-length);
    if (GIT_CONTEXT_TAG_MARKERS.some((marker) => marker.startsWith(suffix))) {
      return length;
    }
  }
  return 0;
}

function startsWithMarker(text: string): boolean {
  const normalized = text.toLowerCase();
  return GIT_CONTEXT_TAG_MARKERS.some(
    (marker) =>
      normalized.startsWith(marker) && isTagBoundary(normalized[marker.length]),
  );
}

function startsWithDistinctivePartialMarker(text: string): boolean {
  const normalized = text.toLowerCase();
  const minimumDistinctivePrefix = "<dyad-git-";
  return (
    normalized.length >= minimumDistinctivePrefix.length &&
    GIT_CONTEXT_TAG_MARKERS.some((marker) => marker.startsWith(normalized))
  );
}

function isTagBoundary(character: string | undefined): boolean {
  return (
    character === undefined ||
    character === ">" ||
    character === "/" ||
    /\s/.test(character)
  );
}
