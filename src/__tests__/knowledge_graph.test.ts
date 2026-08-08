import { describe, expect, it } from "vitest";

import {
  brightnessForNode,
  filterEdges,
  neighbourhood,
  radiusForNode,
  searchNodes,
  toneForNode,
  weightFromCount,
  type GraphNode,
  type KnowledgeGraph,
} from "@/lib/knowledge/graph_model";
import {
  clampCamera,
  DEFAULT_CAMERA,
  layoutGraph,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeAtPoint,
  projectPoint,
  sortByDepth,
} from "@/lib/knowledge/graph_layout";

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    kind: "project",
    label: "Thing",
    clusterId: "cluster-projects",
    weight: 0.5,
    lastActivityAt: NOW,
    ...overrides,
  };
}

describe("node tone reflects real state", () => {
  it("shows problems above everything else", () => {
    // A broken node must never be dressed up as merely active.
    expect(toneForNode(node({ conflict: true, verified: true }), NOW)).toBe(
      "conflict",
    );
  });

  it("marks recently touched things as active", () => {
    expect(toneForNode(node({ lastActivityAt: NOW - 1000 }), NOW)).toBe(
      "active",
    );
  });

  it("colours by kind once activity has aged", () => {
    const old = NOW - 10 * DAY;
    expect(
      toneForNode(node({ kind: "document", lastActivityAt: old }), NOW),
    ).toBe("document");
    expect(
      toneForNode(node({ kind: "conversation", lastActivityAt: old }), NOW),
    ).toBe("memory");
  });

  it("marks verified things", () => {
    expect(
      toneForNode(
        node({ verified: true, lastActivityAt: NOW - 10 * DAY }),
        NOW,
      ),
    ).toBe("verified");
  });

  it("always shows the core as system", () => {
    expect(toneForNode(node({ kind: "core" }), NOW)).toBe("system");
  });
});

describe("brightness reflects recency", () => {
  it("is full for something used today and fades with age", () => {
    expect(brightnessForNode(node({ lastActivityAt: NOW }), NOW)).toBe(1);
    const week = brightnessForNode(
      node({ lastActivityAt: NOW - 7 * DAY }),
      NOW,
    );
    expect(week).toBeLessThan(1);
    expect(week).toBeGreaterThan(0.35);
  });

  it("never fades below legibility", () => {
    const ancient = brightnessForNode(
      node({ lastActivityAt: NOW - 900 * DAY }),
      NOW,
    );
    expect(ancient).toBe(0.35);
  });

  it("dims things never used, without hiding them", () => {
    expect(brightnessForNode(node({ lastActivityAt: null }), NOW)).toBe(0.35);
  });
});

describe("size reflects weight", () => {
  it("grows with weight and keeps the core largest", () => {
    expect(radiusForNode(node({ weight: 1 }))).toBeGreaterThan(
      radiusForNode(node({ weight: 0 })),
    );
    expect(radiusForNode(node({ kind: "core" }))).toBeGreaterThan(
      radiusForNode(node({ weight: 1 })),
    );
  });

  it("compresses outliers so one busy node cannot flatten the rest", () => {
    expect(weightFromCount(0)).toBe(0);
    expect(weightFromCount(5)).toBeGreaterThan(0);
    expect(weightFromCount(5000)).toBeLessThanOrEqual(1);
    expect(weightFromCount(12)).toBeCloseTo(1, 1);
  });
});

describe("edge filtering", () => {
  const edges = [
    { source: "core", target: "cluster-a", strength: 0.1 },
    { source: "cluster-a", target: "n1", strength: 0.9 },
    { source: "n1", target: "n2", strength: 0.2 },
  ];

  it("hides weak links but never strands clusters from the core", () => {
    const kept = filterEdges(edges, 0.5);
    expect(kept).toHaveLength(2);
    expect(kept.some((e) => e.source === "core")).toBe(true);
    expect(kept.some((e) => e.target === "n2")).toBe(false);
  });
});

describe("neighbourhood and search", () => {
  const graph: KnowledgeGraph = {
    nodes: [
      node({ id: "a", label: "Alpha" }),
      node({ id: "b", label: "Beta" }),
    ],
    edges: [{ source: "a", target: "b", strength: 1 }],
    generatedAt: NOW,
  };

  it("includes the node and its direct links", () => {
    expect([...neighbourhood(graph, "a")].sort()).toEqual(["a", "b"]);
  });

  it("searches labels case-insensitively", () => {
    expect(searchNodes(graph.nodes, "alp").map((n) => n.id)).toEqual(["a"]);
    expect(searchNodes(graph.nodes, "")).toEqual([]);
  });
});

describe("layout", () => {
  const graph: KnowledgeGraph = {
    nodes: [
      node({ id: "core", kind: "core", clusterId: null }),
      node({ id: "cluster-projects", kind: "cluster", clusterId: null }),
      node({ id: "p1", clusterId: "cluster-projects" }),
    ],
    edges: [],
    generatedAt: NOW,
  };

  it("puts the core at the origin", () => {
    const laid = layoutGraph(graph);
    expect(laid[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is deterministic, so the graph is learnable", () => {
    const a = layoutGraph(graph);
    const b = layoutGraph(graph);
    expect(a[2].position).toEqual(b[2].position);
  });

  it("places members near their cluster, not the origin", () => {
    const laid = layoutGraph(graph);
    const cluster = laid.find((n) => n.id === "cluster-projects")!;
    const member = laid.find((n) => n.id === "p1")!;
    const toCluster = Math.hypot(
      member.position.x - cluster.position.x,
      member.position.z - cluster.position.z,
    );
    const toOrigin = Math.hypot(member.position.x, member.position.z);
    expect(toCluster).toBeLessThan(toOrigin);
  });
});

describe("camera and projection", () => {
  const viewport = { width: 1000, height: 600 };

  it("clamps pitch and zoom to usable ranges", () => {
    const clamped = clampCamera({ yaw: 9, pitch: 99, zoom: 99 });
    expect(clamped.pitch).toBeLessThan(Math.PI / 2);
    expect(clamped.zoom).toBe(MAX_ZOOM);
    expect(clampCamera({ yaw: 0, pitch: 0, zoom: 0.01 }).zoom).toBe(MIN_ZOOM);
  });

  it("projects the origin to the centre of the view", () => {
    const p = projectPoint({ x: 0, y: 0, z: 0 }, DEFAULT_CAMERA, viewport);
    expect(p.x).toBeCloseTo(viewport.width / 2);
    expect(p.y).toBeCloseTo(viewport.height / 2);
  });

  it("draws nearer things larger", () => {
    const near = projectPoint({ x: 0, y: 0, z: 300 }, DEFAULT_CAMERA, viewport);
    const far = projectPoint({ x: 0, y: 0, z: -300 }, DEFAULT_CAMERA, viewport);
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("never inverts a point behind the camera", () => {
    const behind = projectPoint(
      { x: 0, y: 0, z: 100000 },
      DEFAULT_CAMERA,
      viewport,
    );
    expect(behind.scale).toBeGreaterThan(0);
    expect(Number.isFinite(behind.x)).toBe(true);
  });

  it("sorts far to near so near nodes overlap far ones", () => {
    const sorted = sortByDepth([{ depth: 5 }, { depth: -3 }, { depth: 1 }]);
    expect(sorted.map((s) => s.depth)).toEqual([-3, 1, 5]);
  });
});

describe("hit testing", () => {
  it("picks the nearest node under the pointer", () => {
    const laid = layoutGraph({
      nodes: [node({ id: "a" }), node({ id: "b" })],
      edges: [],
      generatedAt: NOW,
    });
    const entries = [
      {
        node: laid[0],
        screen: { x: 100, y: 100, depth: -10, scale: 1 },
        radius: 20,
      },
      {
        node: laid[1],
        screen: { x: 105, y: 105, depth: -2, scale: 1 },
        radius: 20,
      },
    ];
    expect(nodeAtPoint(entries, { x: 102, y: 102 })?.id).toBe("b");
  });

  it("returns nothing when the pointer misses", () => {
    expect(nodeAtPoint([], { x: 0, y: 0 })).toBeNull();
  });
});
