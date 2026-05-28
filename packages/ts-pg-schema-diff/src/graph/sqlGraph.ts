import { DirectedGraph, isLowerPriorityFromGetPriority } from "./graph.js";
import type { InternalStatement } from "../plan/types.js";

export type SqlPriority = -1 | 0 | 1;

export const sqlPriority = {
  sooner: 1,
  unset: 0,
  later: -1,
} as const satisfies Record<string, SqlPriority>;

export type SqlVertex = {
  readonly id: string;
  readonly priority: SqlPriority;
  readonly statements: readonly InternalStatement[];
};

export type Dependency = {
  readonly source: string;
  readonly target: string;
};

export class SqlGraph {
  readonly #graph = new DirectedGraph<SqlVertex>();

  public addVertex(vertex: SqlVertex): void {
    this.#graph.addVertex(vertex);
  }

  public addDependency(dependency: Dependency): void {
    this.#graph.addEdge(dependency.source, dependency.target);
  }

  public toOrderedStatements(): readonly InternalStatement[] {
    const vertices = this.#graph.topologicallySortWithPriority(
      isLowerPriorityFromGetPriority(
        (vertex) => vertex.statements.length * vertex.priority,
      ),
    );
    return vertices.flatMap((vertex) => vertex.statements);
  }
}
