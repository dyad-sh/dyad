/**
 * BM25 ranking for MCP tool search.
 *
 * The `ToolRanker` type is the stable seam: `search_mcp_tools` depends only
 * on it, so the scoring details below (tokenization, corpus weighting, BM25
 * constants) can be reworked freely without touching the tool, prompt, or
 * capability wiring.
 */

import type { McpToolDef } from "./mcp_type_defs";

export interface RankedTool {
  def: McpToolDef;
  /** BM25 score. Higher is a better match. Always > 0 for returned entries. */
  score: number;
}

/**
 * Given a free-text query and a set of candidate tools, return the tools that
 * match the query, ranked best-first. Non-matching tools (score 0) are
 * omitted.
 */
export type ToolRanker = (query: string, defs: McpToolDef[]) => RankedTool[];

// Standard BM25 free parameters.
const K1 = 1.5;
const B = 0.75;

/**
 * Split text into lowercased terms. Splits on non-alphanumerics and on
 * camelCase / digit boundaries so identifiers like `createIssue` and
 * `listV2Repos` contribute their parts. Trailing plural "s" is folded so a
 * query for "repository" matches "repositories" and "repos" reasonably often.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const withBoundaries = text
    // camelCase / PascalCase boundary: fooBar -> foo Bar
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // letter/digit boundary: v2 -> v 2, 2fa -> 2 fa
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");
  const raw = withBoundaries
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return raw.map(stem);
}

function stem(token: string): string {
  // Naive plural folding only — keep short tokens intact so we don't collapse
  // meaningful words (e.g. "ls", "is"). Handles the common cases that show up
  // in tool/param names: "repositories" -> "repository", "issues" -> "issue".
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Build the searchable document for a tool from everything a model might key
 * off: server name, tool name (raw + JS identifier), description, and the
 * input schema's top-level property names and descriptions.
 */
export function buildToolDocument(def: McpToolDef): string {
  const parts: string[] = [
    def.serverName ?? "",
    def.toolName ?? "",
    def.jsName ?? "",
    def.description ?? "",
  ];

  const schema = def.inputSchema as
    | { properties?: Record<string, unknown> }
    | undefined;
  const properties = schema?.properties;
  if (properties && typeof properties === "object") {
    for (const [propName, propSchema] of Object.entries(properties)) {
      parts.push(propName);
      const desc =
        propSchema &&
        typeof propSchema === "object" &&
        "description" in propSchema
          ? (propSchema as { description?: unknown }).description
          : undefined;
      if (typeof desc === "string") {
        parts.push(desc);
      }
    }
  }

  return parts.join(" ");
}

interface IndexedDoc {
  def: McpToolDef;
  termFreqs: Map<string, number>;
  length: number;
}

export const bm25Ranker: ToolRanker = (query, defs) => {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || defs.length === 0) {
    return [];
  }

  const docs: IndexedDoc[] = defs.map((def) => {
    const terms = tokenize(buildToolDocument(def));
    const termFreqs = new Map<string, number>();
    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
    }
    return { def, termFreqs, length: terms.length };
  });

  const totalLength = docs.reduce((sum, doc) => sum + doc.length, 0);
  const avgdl = totalLength / docs.length || 1;

  // Document frequency per unique query term.
  const uniqueQueryTerms = [...new Set(queryTerms)];
  const docFreq = new Map<string, number>();
  for (const term of uniqueQueryTerms) {
    let df = 0;
    for (const doc of docs) {
      if (doc.termFreqs.has(term)) df += 1;
    }
    docFreq.set(term, df);
  }

  const N = docs.length;
  const ranked: RankedTool[] = [];
  for (const doc of docs) {
    let score = 0;
    for (const term of uniqueQueryTerms) {
      const f = doc.termFreqs.get(term);
      if (!f) continue;
      const df = docFreq.get(term) ?? 0;
      // BM25 idf with the standard +0.5 smoothing. Clamped at 0 so a term
      // present in every document doesn't push scores negative.
      const idf = Math.max(0, Math.log((N - df + 0.5) / (df + 0.5) + 1));
      const denom = f + K1 * (1 - B + (B * doc.length) / avgdl);
      score += idf * ((f * (K1 + 1)) / denom);
    }
    if (score > 0) {
      ranked.push({ def: doc.def, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
};
