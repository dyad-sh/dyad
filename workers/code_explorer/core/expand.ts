import { GraphIndex, SearchHit } from "./types";

export function expandNodes(
  index: GraphIndex,
  roots: SearchHit[],
  maxDepth: number,
): Map<string, number> {
  const selected = new Map<string, number>();
  const queue: Array<{ nodeId: string; depth: number; score: number }> =
    roots.map((root) => ({ nodeId: root.nodeId, depth: 0, score: root.score }));

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    const existing = selected.get(current.nodeId);
    if (existing !== undefined && existing >= current.score) continue;
    selected.set(current.nodeId, current.score);
    if (current.depth >= maxDepth) continue;

    const outgoing = index.edgesOut.get(current.nodeId) ?? [];
    for (const edge of outgoing) {
      queue.push({
        nodeId: edge.to,
        depth: current.depth + 1,
        score: current.score * 0.65,
      });
    }
    const incoming = index.edgesIn.get(current.nodeId) ?? [];
    for (const edge of incoming) {
      const next = edge.from === current.nodeId ? edge.to : edge.from;
      queue.push({
        nodeId: next,
        depth: current.depth + 1,
        score: current.score * 0.65,
      });
    }
  }

  return selected;
}
