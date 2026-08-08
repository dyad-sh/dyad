import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  brightnessForNode,
  filterEdges,
  neighbourhood,
  radiusForNode,
  SHAPE_FOR_KIND,
  TONE_COLORS,
  toneForNode,
  type KnowledgeGraph,
  type NodeShape,
} from "@/lib/knowledge/graph_model";
import {
  clampCamera,
  DEFAULT_CAMERA,
  layoutGraph,
  nodeAtPoint,
  projectPoint,
  type Camera,
  type LaidOutNode,
} from "@/lib/knowledge/graph_layout";

/** Draws the shape that carries this node's meaning. */
function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: NodeShape,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  switch (shape) {
    case "cube": {
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    }
    case "diamond": {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    }
    case "hexagon": {
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "particles": {
      // A memory is a loose group, not a solid object.
      for (let i = 0; i < 5; i += 1) {
        const angle = (Math.PI * 2 * i) / 5;
        const px = x + Math.cos(angle) * r * 0.65;
        const py = y + Math.sin(angle) * r * 0.65;
        ctx.moveTo(px + r * 0.28, py);
        ctx.arc(px, py, r * 0.28, 0, Math.PI * 2);
      }
      break;
    }
    case "ring":
    case "core":
    case "sphere":
    default: {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    }
  }
}

export function KnowledgeCoreCanvas({
  graph,
  selectedId,
  onSelect,
  onOpen,
  minStrength,
  activeIds,
  reducedMotion,
}: {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (node: LaidOutNode | null) => void;
  onOpen: (node: LaidOutNode) => void;
  minStrength: number;
  activeIds: Set<string>;
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  type Projected = {
    node: LaidOutNode;
    screen: ReturnType<typeof projectPoint>;
    radius: number;
  };
  const projectedRef = useRef<Projected[]>([]);
  // Scratch buffers reused every frame. Rebuilding these per frame allocated
  // three node-sized structures sixty times a second, which is pure GC
  // pressure on a graph that can hold a couple of hundred nodes.
  const byIdRef = useRef(new Map<string, Projected>());
  const orderedRef = useRef<Projected[]>([]);

  const laidOut = useMemo(() => layoutGraph(graph), [graph]);
  const edges = useMemo(
    () => filterEdges(graph.edges, minStrength),
    [graph.edges, minStrength],
  );
  const focus = useMemo(
    () => (selectedId ? neighbourhood(graph, selectedId) : null),
    [graph, selectedId],
  );

  // One animation loop drives idle orbit, pulses and particle flow.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let raf = 0;
    const render = () => {
      frame += 1;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const now = Date.now();
      const cam = cameraRef.current;
      const viewport = { width, height };

      // Idle orbit: slow enough to read, absent under reduced motion.
      const drift = reducedMotion || dragRef.current ? 0 : frame * 0.00035;
      const liveCam = { ...cam, yaw: cam.yaw + drift };

      // Project once: this runs for every node on every frame, writing into
      // the reused buffer rather than building a new array.
      const projected = projectedRef.current;
      projected.length = laidOut.length;
      for (let i = 0; i < laidOut.length; i += 1) {
        const node = laidOut[i]!;
        const screen = projectPoint(node.position, liveCam, viewport);
        const radius = radiusForNode(node) * screen.scale;
        const entry = projected[i];
        if (entry) {
          entry.node = node;
          entry.screen = screen;
          entry.radius = radius;
        } else {
          projected[i] = { node, screen, radius };
        }
      }

      const byId = byIdRef.current;
      byId.clear();
      for (const entry of projected) byId.set(entry.node.id, entry);

      // --- connections -----------------------------------------------------
      for (const edge of edges) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) continue;
        const dimmed =
          focus && !(focus.has(edge.source) && focus.has(edge.target));
        const alpha = (dimmed ? 0.06 : 0.1 + edge.strength * 0.3) as number;

        // Curved, not straight: a bowed path reads as depth.
        const mx = (a.screen.x + b.screen.x) / 2;
        const my = (a.screen.y + b.screen.y) / 2 - 26;
        ctx.beginPath();
        ctx.moveTo(a.screen.x, a.screen.y);
        ctx.quadraticCurveTo(mx, my, b.screen.x, b.screen.y);
        ctx.strokeStyle = `rgba(120, 220, 255, ${alpha})`;
        ctx.lineWidth = Math.max(0.4, edge.strength * 1.8);
        ctx.stroke();

        // A particle travelling the link shows which way data flows.
        if (!reducedMotion && !dimmed && edge.strength > 0.5) {
          const t = (frame * 0.006 + edge.strength) % 1;
          const px =
            (1 - t) * (1 - t) * a.screen.x +
            2 * (1 - t) * t * mx +
            t * t * b.screen.x;
          const py =
            (1 - t) * (1 - t) * a.screen.y +
            2 * (1 - t) * t * my +
            t * t * b.screen.y;
          ctx.beginPath();
          ctx.arc(px, py, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(180, 240, 255, 0.75)";
          ctx.fill();
        }
      }

      // --- nodes, far to near ---------------------------------------------
      // Painter's algorithm over the projected depth, so near nodes overlap
      // far ones rather than being drawn under them.
      const ordered = orderedRef.current;
      ordered.length = 0;
      for (const entry of projected) ordered.push(entry);
      ordered.sort((a, b) => a.screen.depth - b.screen.depth);
      for (const entry of ordered) {
        const { node, screen } = entry;
        const tone = toneForNode(node, now);
        const colour = TONE_COLORS[tone];
        const brightness = brightnessForNode(node, now);
        const dimmed = focus && !focus.has(node.id);
        const pulse =
          !reducedMotion && activeIds.has(node.id)
            ? 1 + Math.sin(frame * 0.12) * 0.18
            : 1;
        const radius = Math.max(2, entry.radius * pulse);
        const alpha = (dimmed ? 0.18 : brightness) as number;

        ctx.globalAlpha = alpha;
        ctx.shadowColor = colour;
        ctx.shadowBlur = dimmed ? 0 : 14 * brightness;
        ctx.fillStyle = colour;
        drawShape(ctx, SHAPE_FOR_KIND[node.kind], screen.x, screen.y, radius);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Outlines carry status: gold verified, red in trouble.
        if (node.conflict || node.verified) {
          ctx.strokeStyle = node.conflict ? "#ff5f6d" : "#ffd479";
          ctx.lineWidth = 1.5;
          drawShape(
            ctx,
            SHAPE_FOR_KIND[node.kind],
            screen.x,
            screen.y,
            radius + 3,
          );
          ctx.stroke();
        }

        // Labels only where they can be read: the core, clusters, selection,
        // and anything large enough on screen to deserve one.
        const labelled =
          node.kind === "core" ||
          node.kind === "cluster" ||
          node.id === selectedId ||
          radius > 11;
        if (labelled && !dimmed) {
          ctx.globalAlpha = Math.min(1, alpha + 0.25);
          ctx.fillStyle = "rgba(226, 248, 255, 0.92)";
          ctx.font = `${node.kind === "core" ? 13 : 11}px ui-sans-serif, system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(node.label, screen.x, screen.y + radius + 13);
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [activeIds, edges, focus, laidOut, reducedMotion, selectedId]);

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setCamera((current) =>
      clampCamera({
        ...current,
        yaw: current.yaw + dx * 0.005,
        pitch: current.pitch + dy * 0.005,
      }),
    );
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    // A drag rotates the graph; only a still click selects.
    if (drag?.moved) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hit = nodeAtPoint(projectedRef.current, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    onSelect(hit);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hit = nodeAtPoint(projectedRef.current, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (hit) onOpen(hit);
  };

  const onWheel = useCallback((event: React.WheelEvent) => {
    setCamera((current) =>
      clampCamera({
        ...current,
        zoom: current.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
      }),
    );
  }, []);

  // Keyboard orbiting, so the graph is not mouse-only.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = 0.12;
    if (event.key === "ArrowLeft") {
      setCamera((c) => clampCamera({ ...c, yaw: c.yaw - step }));
    } else if (event.key === "ArrowRight") {
      setCamera((c) => clampCamera({ ...c, yaw: c.yaw + step }));
    } else if (event.key === "ArrowUp") {
      setCamera((c) => clampCamera({ ...c, pitch: c.pitch - step }));
    } else if (event.key === "ArrowDown") {
      setCamera((c) => clampCamera({ ...c, pitch: c.pitch + step }));
    } else if (event.key === "Escape") {
      onSelect(null);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <canvas
      ref={canvasRef}
      className="knowledge-canvas"
      tabIndex={0}
      role="application"
      aria-label={`Knowledge graph with ${graph.nodes.length} nodes. Arrow keys orbit, Escape clears selection.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (dragRef.current = null)}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      data-testid="knowledge-canvas"
    />
  );
}
