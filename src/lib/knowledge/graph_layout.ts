import type { KnowledgeGraph, GraphNode } from "./graph_model";

/**
 * Three-dimensional layout for the Knowledge Core.
 *
 * Deterministic rather than physics-simulated: clusters take fixed orbits
 * around the core and their members spread over a sphere around them. A graph
 * that settles the same way every time is one you can build a mental map of,
 * which a jittering force simulation never gives you.
 */

export type Vec3 = { x: number; y: number; z: number };

export type LaidOutNode = GraphNode & { position: Vec3 };

/** Deterministic pseudo-random in [0,1) from a string — same node, same spot. */
function hashUnit(value: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

const CLUSTER_ORBIT = 260;
const MEMBER_SPREAD = 130;

export function layoutGraph(graph: KnowledgeGraph): LaidOutNode[] {
  const clusters = graph.nodes.filter((node) => node.kind === "cluster");
  const clusterPositions = new Map<string, Vec3>();

  clusters.forEach((cluster, index) => {
    // Even spacing around the core, tilted so the graph reads as volumetric
    // rather than as a flat ring.
    const angle = (index / Math.max(1, clusters.length)) * Math.PI * 2;
    const tilt = (index % 2 === 0 ? 1 : -1) * 0.35;
    clusterPositions.set(cluster.id, {
      x: Math.cos(angle) * CLUSTER_ORBIT,
      y: Math.sin(tilt) * CLUSTER_ORBIT * 0.45,
      z: Math.sin(angle) * CLUSTER_ORBIT,
    });
  });

  return graph.nodes.map((node) => {
    if (node.kind === "core") {
      return { ...node, position: { x: 0, y: 0, z: 0 } };
    }
    if (node.kind === "cluster") {
      return {
        ...node,
        position: clusterPositions.get(node.id) ?? { x: 0, y: 0, z: 0 },
      };
    }

    const anchor = node.clusterId
      ? (clusterPositions.get(node.clusterId) ?? { x: 0, y: 0, z: 0 })
      : { x: 0, y: 0, z: 0 };

    // Fibonacci-ish spherical scatter, seeded by id so it never jumps.
    const u = hashUnit(node.id, 1);
    const v = hashUnit(node.id, 2);
    const r = 0.45 + hashUnit(node.id, 3) * 0.55;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const spread = MEMBER_SPREAD * r;

    return {
      ...node,
      position: {
        x: anchor.x + Math.sin(phi) * Math.cos(theta) * spread,
        y: anchor.y + Math.cos(phi) * spread * 0.7,
        z: anchor.z + Math.sin(phi) * Math.sin(theta) * spread,
      },
    };
  });
}

export type Camera = {
  /** Orbit angles in radians. */
  yaw: number;
  pitch: number;
  zoom: number;
};

export const DEFAULT_CAMERA: Camera = { yaw: 0.6, pitch: -0.25, zoom: 1 };

/** Pitch is clamped so the graph can never be rolled upside down. */
export const MAX_PITCH = Math.PI / 2.4;
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

export function clampCamera(camera: Camera): Camera {
  return {
    yaw: camera.yaw,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.pitch)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)),
  };
}

export type Projected = {
  x: number;
  y: number;
  /** Camera-space depth; larger is nearer. */
  depth: number;
  /** Perspective scale factor for size and line width. */
  scale: number;
};

const FOCAL_LENGTH = 900;

/**
 * Projects a world point to screen space.
 *
 * Points behind the camera are pushed to a minimum depth rather than being
 * allowed to invert — an inverted projection draws nodes mirrored across the
 * screen, which looks like corruption.
 */
export function projectPoint(
  point: Vec3,
  camera: Camera,
  viewport: { width: number; height: number },
): Projected {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);

  const x1 = point.x * cosYaw - point.z * sinYaw;
  const z1 = point.x * sinYaw + point.z * cosYaw;
  const y2 = point.y * cosPitch - z1 * sinPitch;
  const z2 = point.y * sinPitch + z1 * cosPitch;

  const cameraDistance = 900 / camera.zoom;
  const depth = cameraDistance - z2;
  const safeDepth = Math.max(60, depth);
  const scale = FOCAL_LENGTH / safeDepth;

  return {
    x: viewport.width / 2 + x1 * scale,
    y: viewport.height / 2 + y2 * scale,
    depth: -depth,
    scale,
  };
}

/** Painter's algorithm: far nodes drawn first so near ones overlap them. */
export function sortByDepth<T extends { depth: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.depth - b.depth);
}

/** The node under a screen point, nearest first. */
export function nodeAtPoint(
  projected: { node: LaidOutNode; screen: Projected; radius: number }[],
  point: { x: number; y: number },
): LaidOutNode | null {
  const hits = projected.filter((entry) => {
    const dx = entry.screen.x - point.x;
    const dy = entry.screen.y - point.y;
    return Math.hypot(dx, dy) <= Math.max(8, entry.radius);
  });
  if (hits.length === 0) return null;
  return hits.reduce((near, entry) =>
    entry.screen.depth > near.screen.depth ? entry : near,
  ).node;
}
