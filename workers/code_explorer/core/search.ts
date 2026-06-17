import * as path from "node:path";
import { GraphIndex, GraphNode, SearchHit } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "code",
  "file",
  "files",
  "find",
  "flow",
  "for",
  "from",
  "how",
  "identify",
  "implementation",
  "including",
  "in",
  "involved",
  "is",
  "key",
  "of",
  "package",
  "packages",
  "part",
  "project",
  "related",
  "repo",
  "repository",
  "source",
  "start",
  "starting",
  "symbol",
  "symbols",
  "the",
  "they",
  "to",
  "trace",
  "where",
  "workspace",
]);

export function extractTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9_.$-]+/)
        .flatMap((term) => term.split(/[._$-]+/))
        .flatMap((term) => expandTerm(term.trim().toLowerCase()))
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
    ),
  ];
}

function expandTerm(term: string): string[] {
  if (!term) return [];
  const expanded = [term];

  if (/^creat(?:e|es|ed|ing|ion|ions)$/.test(term)) {
    expanded.push("create");
  }
  if (/^sav(?:e|es|ed|ing)$/.test(term)) {
    expanded.push("save");
  }
  if (/^submitt?(?:s|ed|ing)?$/.test(term)) {
    expanded.push("submit");
  }
  if (/^persist(?:s|ed|ing|ence)?$/.test(term)) {
    expanded.push("persist");
  }
  if (/^updat(?:e|es|ed|ing)$/.test(term)) {
    expanded.push("update");
  }
  if (/^delet(?:e|es|ed|ing|ion)$/.test(term)) {
    expanded.push("delete");
  }
  if (/^s(?:end|ends|ent|ending)$/.test(term)) {
    expanded.push("send");
  }
  if (/^start(?:s|ed|ing)?$/.test(term)) {
    expanded.push("start");
  }
  if (/^actions?$/.test(term)) {
    expanded.push("action");
  }
  if (/^clients?$/.test(term)) {
    expanded.push("client");
  }
  if (/^components?$/.test(term)) {
    expanded.push("component");
  }
  if (/^handlers?$/.test(term)) {
    expanded.push("handler");
  }
  if (/^hooks?$/.test(term)) {
    expanded.push("hook");
  }
  if (/^routes?$/.test(term)) {
    expanded.push("route");
  }
  if (/^services?$/.test(term)) {
    expanded.push("service");
  }
  if (/^types?$/.test(term)) {
    expanded.push("type");
  }
  if (/^views?$/.test(term)) {
    expanded.push("view");
  }

  return expanded;
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

  const isTest = isTestOrSupportPath(file);
  const asksForTests = terms.some((term) =>
    ["test", "tests", "spec", "vitest"].includes(term),
  );
  if (isTest && !asksForTests) score *= 0.5;

  score += scoreMutationIntent({
    terms,
    file,
    name,
    qualified,
    asksForTests,
  });

  return score;
}

function scoreMutationIntent({
  terms,
  file,
  name,
  qualified,
  asksForTests,
}: {
  terms: string[];
  file: string;
  name: string;
  qualified: string;
  asksForTests: boolean;
}): number {
  const actionTerms = [
    "create",
    "delete",
    "mutation",
    "persist",
    "save",
    "submit",
  ];
  const genericMutationTerms = [
    "api",
    "client",
    "component",
    "form",
    "handle",
    "handler",
    "hook",
    "route",
    "send",
    "service",
    "sink",
    "type",
  ];
  const isMutationQuery = terms.some((term) => actionTerms.includes(term));
  if (!isMutationQuery) {
    return 0;
  }

  const domainTerms = terms.filter(
    (term) =>
      term.length >= 4 &&
      !actionTerms.includes(term) &&
      !genericMutationTerms.includes(term),
  );
  const compactName = name.replace(/[^a-z0-9]/g, "");
  const compactQualified = qualified.replace(/[^a-z0-9]/g, "");
  const hasDomainInPath = domainTerms.some((term) => file.includes(term));
  const hasDomainInSymbol = domainTerms.some(
    (term) => compactName.includes(term) || compactQualified.includes(term),
  );
  const hasDomain = hasDomainInPath || hasDomainInSymbol;
  const hasMutationPathIntent =
    file.includes("/api/") ||
    file.includes("/handler") ||
    file.includes("/hooks/") ||
    file.includes("/mutations/") ||
    file.includes("/service/") ||
    file.includes("/services/") ||
    file.includes("create") ||
    file.includes("form") ||
    file.includes("submit");

  let score = 0;
  if (hasDomain && hasMutationPathIntent) {
    score += 35;
  }
  if (hasDomainInPath && file.startsWith("packages/")) {
    score += 25;
  }
  if (hasDomain && actionTerms.some((term) => compactName.includes(term))) {
    score += 25;
  }
  for (const action of actionTerms) {
    for (const domain of domainTerms) {
      if (
        compactName.includes(`${action}${domain}`) ||
        compactQualified.includes(`${action}${domain}`) ||
        compactName.includes(`handle${domain}`) ||
        compactQualified.includes(`handle${domain}`)
      ) {
        score += 70;
      }
    }
  }

  if (!hasDomain && hasMutationPathIntent) {
    score -= 120;
  }
  if (
    file.includes("dropdown") ||
    file.includes("menu") ||
    file.includes("detail") ||
    file.includes("history") ||
    file.includes("list") ||
    file.includes("listitem") ||
    file.includes("logs") ||
    file.includes("successful") ||
    file.includes("success")
  ) {
    score -= 25;
  }
  if (
    !hasMutationPathIntent &&
    (file.includes("container") ||
      file.includes("history") ||
      file.includes("list") ||
      file.includes("logs"))
  ) {
    score -= 60;
  }
  if (isTestOrSupportPath(file) && !asksForTests) {
    score -= 120;
  }

  return score;
}

function isTestOrSupportPath(file: string): boolean {
  return /(\.|\/)(test|spec|e2e)\.[tj]sx?$|__tests__|(^|\/)(test|tests|testing|e2e|playwright|fixtures|mocks?)(\/|$)/.test(
    file,
  );
}
