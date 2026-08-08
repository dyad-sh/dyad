/**
 * The Knowledge Core graph model.
 *
 * Every visual property here is derived from something real — how many
 * messages a conversation holds, when a project was last touched, whether an
 * agent is reachable. Nothing is decorative for its own sake: if a node glows
 * brighter it is because it was used more recently, and if it is larger it
 * carries more.
 */

export type NodeKind =
  | "core"
  | "cluster"
  | "project"
  | "conversation"
  | "agent"
  | "document"
  | "provider";

/** Shapes carry meaning, so a glance tells you what kind of thing a node is. */
export type NodeShape =
  | "core"
  | "sphere"
  | "cube"
  | "hexagon"
  | "diamond"
  | "ring"
  | "particles";

export type NodeTone =
  | "system"
  | "general"
  | "document"
  | "memory"
  | "verified"
  | "active"
  | "conflict";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  /** Cluster this node belongs to; the core belongs to none. */
  clusterId: string | null;
  /** 0–1. Drives node size: how much this node carries. */
  weight: number;
  /** Epoch ms of last real activity, or null when never used. */
  lastActivityAt: number | null;
  /** Set when the underlying thing is in a bad state. */
  conflict?: boolean;
  /** True when the item is confirmed reachable/valid. */
  verified?: boolean;
  /** Where a double-click should take the user. */
  route?: string;
  /** Extra facts for the inspector panel. */
  detail?: Record<string, string | number>;
};

export type GraphEdge = {
  source: string;
  target: string;
  /** 0–1. Drives line thickness: how strong the relationship is. */
  strength: number;
};

export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** When the snapshot was taken, so the UI can say how fresh it is. */
  generatedAt: number;
};

export const SHAPE_FOR_KIND: Record<NodeKind, NodeShape> = {
  core: "core",
  cluster: "ring",
  project: "diamond",
  conversation: "particles",
  agent: "hexagon",
  document: "cube",
  provider: "hexagon",
};

/** Six meanings, six colours — kept few so the scene stays readable. */
export const TONE_COLORS: Record<NodeTone, string> = {
  system: "#ffffff",
  general: "#00e5ff",
  document: "#4d9fff",
  memory: "#a77bff",
  verified: "#3ddc97",
  active: "#ff9f45",
  conflict: "#ff5f6d",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A node's tone. Problems outrank everything — a conflicted node must never
 * be hidden behind a friendlier colour.
 */
export function toneForNode(node: GraphNode, now: number): NodeTone {
  if (node.conflict) return "conflict";
  if (node.kind === "core") return "system";
  if (node.verified) return "verified";
  // Touched today counts as active work.
  if (node.lastActivityAt && now - node.lastActivityAt < DAY_MS) {
    return "active";
  }
  if (node.kind === "document") return "document";
  if (node.kind === "conversation") return "memory";
  return "general";
}

/**
 * Brightness from recency: bright when used today, fading over a fortnight to
 * a floor that keeps old nodes legible rather than invisible.
 */
export function brightnessForNode(node: GraphNode, now: number): number {
  if (node.kind === "core") return 1;
  if (!node.lastActivityAt) return 0.35;
  const ageDays = Math.max(0, (now - node.lastActivityAt) / DAY_MS);
  if (ageDays <= 1) return 1;
  return Math.max(0.35, 1 - (ageDays - 1) / 14);
}

/** Radius in world units, from weight. Clamped so nothing dominates. */
export function radiusForNode(node: GraphNode): number {
  if (node.kind === "core") return 34;
  if (node.kind === "cluster") return 20;
  const weight = Math.min(1, Math.max(0, node.weight));
  return 6 + weight * 12;
}

/** A node is "live" when something is happening to it right now. */
export function isPulsing(node: GraphNode, activeIds: Set<string>): boolean {
  return activeIds.has(node.id);
}

/** Normalises a raw count onto 0–1 without letting outliers flatten the rest. */
export function weightFromCount(count: number, typical = 12): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(typical));
}

/**
 * Hides connections below a threshold so a dense graph stays readable.
 * The core's own links always survive — losing them would strand clusters.
 */
export function filterEdges(
  edges: GraphEdge[],
  minStrength: number,
  coreId = "core",
): GraphEdge[] {
  return edges.filter(
    (edge) =>
      edge.strength >= minStrength ||
      edge.source === coreId ||
      edge.target === coreId,
  );
}

/** Node ids within one hop of the given node, plus the node itself. */
export function neighbourhood(
  graph: KnowledgeGraph,
  nodeId: string,
): Set<string> {
  const ids = new Set<string>([nodeId]);
  for (const edge of graph.edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    else if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}

export function searchNodes(nodes: GraphNode[], query: string): GraphNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes.filter((node) => node.label.toLowerCase().includes(needle));
}
