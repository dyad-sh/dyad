import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, RefreshCw, Search, X } from "lucide-react";

import { ipc } from "@/ipc/types";
import { KnowledgeCoreCanvas } from "@/components/knowledge/KnowledgeCoreCanvas";
import {
  searchNodes,
  toneForNode,
  TONE_COLORS,
  type KnowledgeGraph,
} from "@/lib/knowledge/graph_model";
import type { LaidOutNode } from "@/lib/knowledge/graph_layout";
import { cn } from "@/lib/utils";

const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [], generatedAt: 0 };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Knowledge Core — the app's own knowledge as a navigable graph.
 *
 * Every node is a real record: a project, a conversation, an agent, a document
 * or a configured provider. Size, colour and brightness are read from that
 * data rather than chosen for effect.
 */
export default function KnowledgeCorePage() {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const [selected, setSelected] = useState<LaidOutNode | null>(null);
  const [query, setQuery] = useState("");
  const [minStrength, setMinStrength] = useState(0);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["knowledge-graph"],
    queryFn: () => ipc.knowledgeGraph.getGraph(),
    staleTime: 30_000,
  });

  const graph = data ?? EMPTY_GRAPH;
  const now = Date.now();

  const matches = useMemo(
    () => searchNodes(graph.nodes, query).slice(0, 8),
    [graph.nodes, query],
  );

  // Nodes are "active" when something touched them in the last minute — real
  // activity, not decoration.
  const activeIds = useMemo(
    () =>
      new Set(
        graph.nodes
          .filter(
            (node) => node.lastActivityAt && now - node.lastActivityAt < 60_000,
          )
          .map((node) => node.id),
      ),
    [graph.nodes, now],
  );

  const openNode = (node: LaidOutNode) => {
    if (node.route) void navigate({ to: node.route });
  };

  return (
    <div className="knowledge-core home-jarvis" data-testid="knowledge-core">
      <header className="knowledge-header">
        <div>
          <h1 className="knowledge-title font-jarvis-display">
            Knowledge Core
          </h1>
          <p className="knowledge-subtitle">
            {isLoading
              ? "Reading your knowledge…"
              : `${graph.nodes.length} nodes · ${graph.edges.length} connections`}
          </p>
        </div>

        <div className="knowledge-controls">
          <div className="knowledge-search">
            <Search className="size-3.5 opacity-60" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the graph…"
              aria-label="Search knowledge graph"
              data-testid="knowledge-search"
            />
          </div>

          <label className="knowledge-filter">
            <span>Hide weak links</span>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.1}
              value={minStrength}
              onChange={(event) => setMinStrength(Number(event.target.value))}
              aria-label="Minimum connection strength"
            />
          </label>

          <button
            type="button"
            onClick={() => void refetch()}
            className="knowledge-refresh"
            aria-label="Rebuild graph"
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      </header>

      {matches.length > 0 && (
        <div className="knowledge-matches">
          {matches.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                setSelected(node as LaidOutNode);
                setQuery("");
              }}
              style={{ borderColor: TONE_COLORS[toneForNode(node, now)] }}
            >
              {node.label}
            </button>
          ))}
        </div>
      )}

      <div className="knowledge-stage">
        <KnowledgeCoreCanvas
          graph={graph}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onOpen={openNode}
          minStrength={minStrength}
          activeIds={activeIds}
          reducedMotion={reducedMotion}
        />

        {selected && (
          <aside
            className="knowledge-inspector"
            data-testid="knowledge-inspector"
          >
            <header>
              <span
                className="knowledge-inspector-dot"
                style={{ background: TONE_COLORS[toneForNode(selected, now)] }}
                aria-hidden
              />
              <h2>{selected.label}</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close inspector"
              >
                <X className="size-3.5" />
              </button>
            </header>

            <dl>
              {Object.entries(selected.detail ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
              <div>
                <dt>Last activity</dt>
                <dd>
                  {selected.lastActivityAt
                    ? new Date(selected.lastActivityAt).toLocaleString()
                    : "Never used"}
                </dd>
              </div>
            </dl>

            <h3>Connected to</h3>
            <ul className="knowledge-connections">
              {graph.edges
                .filter(
                  (edge) =>
                    edge.source === selected.id || edge.target === selected.id,
                )
                .slice(0, 12)
                .map((edge, index) => {
                  const otherId =
                    edge.source === selected.id ? edge.target : edge.source;
                  const other = graph.nodes.find((n) => n.id === otherId);
                  if (!other) return null;
                  return (
                    <li key={`${otherId}-${index}`}>
                      <button
                        type="button"
                        onClick={() => setSelected(other as LaidOutNode)}
                      >
                        {other.label}
                      </button>
                    </li>
                  );
                })}
            </ul>

            {selected.route && (
              <button
                type="button"
                className="knowledge-open"
                onClick={() => openNode(selected)}
              >
                Open
              </button>
            )}
          </aside>
        )}

        {!isLoading && graph.nodes.length <= 6 && (
          <p className="knowledge-empty">
            Your graph grows as you work — build an app, hold a conversation,
            add an agent or drop documents in your vault.
          </p>
        )}
      </div>

      <footer className="knowledge-legend" aria-label="Legend">
        {(
          [
            ["general", "Knowledge"],
            ["document", "Documents"],
            ["memory", "Conversations"],
            ["verified", "Verified"],
            ["active", "Active today"],
            ["conflict", "Needs attention"],
          ] as const
        ).map(([tone, label]) => (
          <span key={tone} className={cn("knowledge-legend-item")}>
            <span style={{ background: TONE_COLORS[tone] }} aria-hidden />
            {label}
          </span>
        ))}
      </footer>
    </div>
  );
}
