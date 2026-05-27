export type Vertex = {
  readonly id: string;
};

export type PriorityComparator<TVertex extends Vertex> = (
  left: TVertex,
  right: TVertex,
) => boolean;

export class DirectedGraph<TVertex extends Vertex> {
  readonly #verticesById = new Map<string, TVertex>();
  readonly #edges = new Map<string, Set<string>>();

  public addVertex(vertex: TVertex): void {
    this.#verticesById.set(vertex.id, vertex);
    if (!this.#edges.has(vertex.id)) {
      this.#edges.set(vertex.id, new Set());
    }
  }

  public addEdge(sourceId: string, targetId: string): void {
    if (!this.#verticesById.has(sourceId)) {
      throw new Error(`source ${sourceId} does not exist`);
    }
    if (!this.#verticesById.has(targetId)) {
      throw new Error(`target ${targetId} does not exist`);
    }
    const edges = this.#edges.get(sourceId);
    if (edges === undefined) {
      throw new Error(`source ${sourceId} does not have an edge set`);
    }
    edges.add(targetId);
  }

  public hasVertex(id: string): boolean {
    return this.#verticesById.has(id);
  }

  public getVertex(id: string): TVertex {
    const vertex = this.#verticesById.get(id);
    if (vertex === undefined) {
      throw new Error(`vertex ${id} does not exist`);
    }
    return vertex;
  }

  public union(
    other: DirectedGraph<TVertex>,
    merge: (oldVertex: TVertex, newVertex: TVertex) => TVertex,
  ): void {
    for (const newVertex of other.#verticesById.values()) {
      if (this.hasVertex(newVertex.id)) {
        const oldVertex = this.getVertex(newVertex.id);
        const merged = merge(oldVertex, newVertex);
        if (merged.id !== newVertex.id) {
          throw new Error(
            `the merge function must return a vertex with the same id: expected ${newVertex.id} but found ${merged.id}`,
          );
        }
        this.addVertex(merged);
      } else {
        this.addVertex(newVertex);
      }
    }

    for (const [source, targets] of other.#edges) {
      for (const target of targets) {
        this.addEdge(source, target);
      }
    }
  }

  public topologicallySort(): readonly TVertex[] {
    return this.topologicallySortWithPriority(() => false);
  }

  public topologicallySortWithPriority(
    isLowerPriority: PriorityComparator<TVertex>,
  ): readonly TVertex[] {
    const verticesById = new Map(this.#verticesById);
    const edges = cloneEdges(this.#edges);
    const incomingEdgeCountByVertex = buildIncomingCounts(verticesById, edges);
    const output: TVertex[] = [];

    while (verticesById.size > 0) {
      const sources: TVertex[] = [];
      for (const [id, incomingEdgeCount] of incomingEdgeCountByVertex) {
        if (incomingEdgeCount === 0 && verticesById.has(id)) {
          sources.push(this.getVertex(id));
        }
      }

      sources.sort((left, right) => left.id.localeCompare(right.id));

      const source = highestPrioritySource(sources, isLowerPriority);
      if (source === null) {
        throw new Error(
          `cycle detected: ${formatCycleDebug(verticesById, edges, incomingEdgeCountByVertex)}`,
        );
      }

      output.push(source);

      const targets = edges.get(source.id) ?? new Set<string>();
      for (const target of targets) {
        const currentCount = incomingEdgeCountByVertex.get(target);
        if (currentCount === undefined) {
          throw new Error(`target ${target} missing from incoming count map`);
        }
        incomingEdgeCountByVertex.set(target, currentCount - 1);
      }

      verticesById.delete(source.id);
      edges.delete(source.id);
      incomingEdgeCountByVertex.delete(source.id);
    }

    return output;
  }
}

export function isLowerPriorityFromGetPriority<
  TVertex extends Vertex,
  TPriority extends number | string,
>(getPriority: (vertex: TVertex) => TPriority): PriorityComparator<TVertex> {
  return (left, right) => getPriority(left) < getPriority(right);
}

function highestPrioritySource<TVertex extends Vertex>(
  sources: readonly TVertex[],
  isLowerPriority: PriorityComparator<TVertex>,
): TVertex | null {
  let highest: TVertex | null = null;
  for (const source of sources) {
    if (highest === null || isLowerPriority(highest, source)) {
      highest = source;
    }
  }
  return highest;
}

function cloneEdges(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  const cloned = new Map<string, Set<string>>();
  for (const [source, targets] of edges) {
    cloned.set(source, new Set(targets));
  }
  return cloned;
}

function buildIncomingCounts<TVertex extends Vertex>(
  verticesById: ReadonlyMap<string, TVertex>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of verticesById.keys()) {
    counts.set(id, 0);
  }
  for (const targets of edges.values()) {
    for (const target of targets) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function formatCycleDebug<TVertex extends Vertex>(
  verticesById: ReadonlyMap<string, TVertex>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  incomingEdgeCountByVertex: ReadonlyMap<string, number>,
): string {
  const remainingVertices = [...verticesById.keys()].sort().join(", ");
  const edgeList = [...edges.entries()]
    .flatMap(([source, targets]) =>
      [...targets].map((target) => `${source}->${target}`),
    )
    .sort()
    .join(", ");
  const incoming = [...incomingEdgeCountByVertex.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => `${id}:${count}`)
    .join(", ");
  return `vertices=[${remainingVertices}], edges=[${edgeList}], incoming=[${incoming}]`;
}
