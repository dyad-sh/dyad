import { GraphIndex, SearchHit } from "./types";

const MAX_EXPAND_QUEUE_ENTRIES = 50_000;

export function expandNodes(
  index: GraphIndex,
  roots: SearchHit[],
  maxDepth: number,
): Map<string, number> {
  const selected = new Map<string, number>();
  const queuedBest = new Map<string, number>();
  const queue: Array<{ nodeId: string; depth: number; score: number }> =
    roots.map((root) => ({ nodeId: root.nodeId, depth: 0, score: root.score }));
  for (const root of roots) {
    queuedBest.set(root.nodeId, root.score);
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    const existing = selected.get(current.nodeId);
    if (existing !== undefined && existing >= current.score) continue;
    selected.set(current.nodeId, current.score);
    if (current.depth >= maxDepth) continue;

    const outgoing = index.edgesOut.get(current.nodeId) ?? [];
    for (const edge of outgoing) {
      enqueueNode(queue, queuedBest, selected, {
        nodeId: edge.to,
        depth: current.depth + 1,
        score: current.score * 0.65,
      });
    }
    const incoming = index.edgesIn.get(current.nodeId) ?? [];
    for (const edge of incoming) {
      const next = edge.from === current.nodeId ? edge.to : edge.from;
      enqueueNode(queue, queuedBest, selected, {
        nodeId: next,
        depth: current.depth + 1,
        score: current.score * 0.65,
      });
    }
  }

  return selected;
}

function enqueueNode(
  queue: Array<{ nodeId: string; depth: number; score: number }>,
  queuedBest: Map<string, number>,
  selected: Map<string, number>,
  next: { nodeId: string; depth: number; score: number },
): void {
  if (queue.length >= MAX_EXPAND_QUEUE_ENTRIES) {
    return;
  }
  const selectedScore = selected.get(next.nodeId);
  if (selectedScore !== undefined && selectedScore >= next.score) {
    return;
  }
  const queuedScore = queuedBest.get(next.nodeId);
  if (queuedScore !== undefined && queuedScore >= next.score) {
    return;
  }
  queuedBest.set(next.nodeId, next.score);
  queue.push(next);
}
