/**
 * Finding the handful of memories worth putting in front of the model.
 *
 * Semantic similarity alone is a poor ranking for memory: the nearest chunk is
 * often an old conversation that merely used the same words, while the thing
 * that actually helps is the current project's living notes. The scoring here
 * starts from the vector score and then adjusts for the things similarity
 * cannot see — what kind of memory it is, how recently it was touched, whether
 * it names something the user just named, and whether it belongs to the
 * project being worked on.
 *
 * Everything in this module is pure. The Qdrant and filesystem calls live in
 * the indexer, so ranking can be tested without either.
 */

import path from "node:path";

import type { MemoryKind, RetrievedMemory } from "./memory_context";

/** Where a memory file sits decides what kind of memory it holds. */
export type MemoryClassification = {
  kind: MemoryKind;
  /** Project name, for files under Memory/Projects. */
  project: string | null;
  /** Person's name, for files under Memory/People. */
  person: string | null;
};

const NORMALISED_SEPARATOR = /\\/g;

export function classifyMemoryPath(
  vaultRelativePath: string,
): MemoryClassification {
  const normalised = vaultRelativePath.replace(NORMALISED_SEPARATOR, "/");
  const name = path.basename(normalised).replace(/\.mdx?$/i, "");

  if (normalised.includes("Memory/Projects/")) {
    return { kind: "project-memory", project: name, person: null };
  }
  if (normalised.includes("Memory/People/")) {
    return { kind: "person", project: null, person: name };
  }
  if (normalised.includes("Memory/Long Term Memory/")) {
    return { kind: "long-term", project: null, person: null };
  }
  if (normalised.includes("Memory/Summaries/")) {
    return { kind: "conversation-summary", project: null, person: null };
  }
  return { kind: "conversation", project: null, person: null };
}

// ── Entity detection ───────────────────────────────────────────────────────

/**
 * Names the user just used, so memories about them can be favoured.
 *
 * Deliberately crude — capitalised words and quoted phrases. A cleverer
 * extractor would need a model call on the critical path, and the cost of a
 * miss here is only that a memory ranks slightly lower.
 */
export function detectEntities(message: string): string[] {
  const found = new Set<string>();

  for (const match of message.matchAll(/"([^"]{2,60})"/g)) {
    found.add(match[1]!.trim().toLowerCase());
  }
  // Runs of capitalised words: "MetaHuman OS", "Tiffany".
  for (const match of message.matchAll(
    /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)\b/g,
  )) {
    const phrase = match[1]!.trim();
    // A capitalised word starting a sentence is usually not an entity.
    if (phrase.length < 3) continue;
    found.add(phrase.toLowerCase());
  }

  return [...found];
}

/** Whether a memory names something the user just named. */
export function matchesEntity(
  memory: { project: string | null; person: string | null; content: string },
  entities: string[],
): boolean {
  if (entities.length === 0) return false;
  const haystack = [memory.project, memory.person]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());

  for (const entity of entities) {
    if (haystack.some((value) => value === entity || value.includes(entity))) {
      return true;
    }
  }
  return false;
}

// ── Ranking ────────────────────────────────────────────────────────────────

export type ScorableMemory = {
  kind: MemoryKind;
  project: string | null;
  person: string | null;
  content: string;
  /** Raw similarity from the vector search, 0..1. */
  similarity: number;
  updatedAt?: string;
};

/** Weight per kind, expressing what tends to be useful rather than merely similar. */
const KIND_WEIGHT: Record<MemoryKind, number> = {
  "project-memory": 0.25,
  "long-term": 0.2,
  person: 0.15,
  "conversation-summary": 0.1,
  conversation: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recent memories are likelier to still be true. Decays over about a season. */
export function recencyBoost(
  updatedAt: string | undefined,
  now: number,
): number {
  if (!updatedAt) return 0;
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) return 0;
  const ageDays = Math.max(0, (now - updated) / DAY_MS);
  return 0.15 * Math.exp(-ageDays / 90);
}

/**
 * The score memories are ordered by.
 *
 * Similarity carries the most weight, but never all of it: a living project
 * file that is merely relevant should outrank a year-old chat that happens to
 * share vocabulary.
 */
export function scoreMemory(
  memory: ScorableMemory,
  context: {
    entities: string[];
    activeProject?: string | null;
    now?: number;
  },
): number {
  const now = context.now ?? Date.now();
  let score = memory.similarity;

  score += KIND_WEIGHT[memory.kind];
  score += recencyBoost(memory.updatedAt, now);

  if (matchesEntity(memory, context.entities)) {
    score += 0.2;
  }

  // The project being worked on right now is the strongest signal available.
  if (
    context.activeProject &&
    memory.project &&
    memory.project.toLowerCase() === context.activeProject.toLowerCase()
  ) {
    score += 0.3;
  }

  return score;
}

/**
 * Drops chunks that are substantially contained in a higher-ranked one.
 *
 * Overlapping chunks from the same file are the common case — they say the
 * same thing twice and spend the budget doing it.
 */
export function dropOverlapping(
  memories: RetrievedMemory[],
): RetrievedMemory[] {
  const kept: RetrievedMemory[] = [];
  for (const memory of memories) {
    const normalised = normalise(memory.content);
    const redundant = kept.some((existing) => {
      if (existing.sourcePath !== memory.sourcePath) return false;
      const other = normalise(existing.content);
      return other.includes(normalised) || normalised.includes(other);
    });
    if (!redundant) kept.push(memory);
  }
  return kept;
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
