import { describe, expect, it } from "vitest";
import {
  DirectedGraph,
  isLowerPriorityFromGetPriority,
} from "../src/graph/graph.js";
import { SqlGraph, sqlPriority } from "../src/graph/sqlGraph.js";
import type { InternalStatement } from "../src/plan/types.js";

describe("DirectedGraph", () => {
  it("sorts deterministically by id when priority does not decide", () => {
    const graph = new DirectedGraph<{
      readonly id: string;
      readonly priority: number;
    }>();
    graph.addVertex({ id: "b", priority: 0 });
    graph.addVertex({ id: "a", priority: 0 });
    graph.addVertex({ id: "c", priority: 0 });

    expect(
      graph
        .topologicallySortWithPriority(
          isLowerPriorityFromGetPriority((vertex) => vertex.priority),
        )
        .map((vertex) => vertex.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("chooses higher-priority available sources before lower-priority sources", () => {
    const graph = new DirectedGraph<{
      readonly id: string;
      readonly priority: number;
    }>();
    graph.addVertex({ id: "a", priority: 0 });
    graph.addVertex({ id: "b", priority: 10 });
    graph.addVertex({ id: "c", priority: -1 });
    graph.addEdge("b", "c");

    expect(
      graph
        .topologicallySortWithPriority(
          isLowerPriorityFromGetPriority((vertex) => vertex.priority),
        )
        .map((vertex) => vertex.id),
    ).toEqual(["b", "a", "c"]);
  });

  it("throws a useful cycle error", () => {
    const graph = new DirectedGraph<{ readonly id: string }>();
    graph.addVertex({ id: "a" });
    graph.addVertex({ id: "b" });
    graph.addEdge("a", "b");
    graph.addEdge("b", "a");

    expect(() => graph.topologicallySort()).toThrow(
      /cycle detected: .*a->b.*b->a/u,
    );
  });
});

describe("SqlGraph", () => {
  it("orders statements by dependencies and weighted priority", () => {
    const graph = new SqlGraph();
    graph.addVertex({
      id: "drop",
      priority: sqlPriority.later,
      statements: [statement("DROP INDEX old_idx")],
    });
    graph.addVertex({
      id: "create",
      priority: sqlPriority.sooner,
      statements: [
        statement("CREATE INDEX new_idx ON users (id)"),
        statement("ANALYZE users"),
      ],
    });
    graph.addVertex({
      id: "rename",
      priority: sqlPriority.unset,
      statements: [statement("ALTER INDEX old_idx RENAME TO tmp_idx")],
    });
    graph.addDependency({ source: "rename", target: "create" });
    graph.addDependency({ source: "rename", target: "drop" });

    expect(graph.toOrderedStatements().map((item) => item.sql)).toEqual([
      "ALTER INDEX old_idx RENAME TO tmp_idx",
      "CREATE INDEX new_idx ON users (id)",
      "ANALYZE users",
      "DROP INDEX old_idx",
    ]);
  });
});

function statement(sql: string): InternalStatement {
  return {
    sql,
    timeoutMs: 3_000,
    lockTimeoutMs: 3_000,
    hazards: [],
    skipValidation: false,
  };
}
