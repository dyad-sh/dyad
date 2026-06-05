import * as path from "node:path";
import { GraphIndex, GraphNode, SearchHit } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "of",
  "the",
  "to",
  "trace",
  "where",
]);

export function extractTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9_.$-]+/)
        .flatMap((term) => term.split(/[._$-]+/))
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
    ),
  ];
}

export function searchNodes(index: GraphIndex, query: string): SearchHit[] {
  const terms = extractTerms(query);
  const hits = new Map<string, number>();

  for (const node of index.nodes.values()) {
    if (node.kind === "file") continue;
    const score = scoreNode(node, terms, query);
    if (score > 0) {
      hits.set(node.id, score);
    }
  }

  for (const term of terms) {
    const exact = index.byName.get(term);
    if (!exact) continue;
    for (const nodeId of exact) {
      hits.set(nodeId, (hits.get(nodeId) ?? 0) + 50);
    }
  }

  return [...hits.entries()]
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function scoreNode(node: GraphNode, terms: string[], query: string): number {
  const name = node.name.toLowerCase();
  const qualified = node.qualifiedName.toLowerCase();
  const file = node.filePath.toLowerCase();
  const basename = path.basename(file);
  const queryLower = query.toLowerCase();
  let score = 0;
  let matchedTerms = 0;

  for (const term of terms) {
    if (name === term) {
      score += 50;
      matchedTerms++;
    } else if (qualified.includes(term)) {
      score += 30;
      matchedTerms++;
    } else if (name.startsWith(term)) {
      score += 25;
      matchedTerms++;
    } else if (name.includes(term)) {
      score += 15;
      matchedTerms++;
    }

    if (basename.includes(term)) score += 12;
    if (file.includes(term)) score += 5;
  }

  if (["class", "function", "method"].includes(node.kind)) score += 5;
  if (matchedTerms > 1) score += matchedTerms * 8;

  const queryAsName = queryLower.replace(/\s+/g, "");
  if (queryAsName && name.toLowerCase() === queryAsName) score += 35;

  const isTest = /(\.|\/)(test|spec)\.[tj]sx?$|__tests__/.test(file);
  const asksForTests = terms.some((term) =>
    ["test", "tests", "spec", "vitest"].includes(term),
  );
  if (isTest && !asksForTests) score *= 0.5;

  return score;
}
