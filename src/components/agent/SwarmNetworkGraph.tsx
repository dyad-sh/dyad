/**
 * SwarmNetworkGraph — Pure SVG hierarchical tree visualization of agents within a swarm.
 * Renders agents as nodes with parent→child edges, colored by status/role.
 */

import React, { useMemo, useCallback } from "react";
import type { AgentNode, AgentNodeId } from "@/ipc/agent_swarm_client";

// =============================================================================
// TYPES
// =============================================================================

interface SwarmNetworkGraphProps {
  agents: AgentNode[];
  selectedAgentId?: AgentNodeId;
  onSelectAgent?: (agentId: AgentNodeId) => void;
}

interface LayoutNode {
  agent: AgentNode;
  x: number;
  y: number;
  children: LayoutNode[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const NODE_RADIUS = 24;
const LEVEL_HEIGHT = 100;
const NODE_SPACING = 80;
const PADDING = 60;

const STATUS_COLORS: Record<string, string> = {
  idle: "#6b7280",
  running: "#22c55e",
  busy: "#f59e0b",
  stopped: "#ef4444",
  terminated: "#991b1b",
  replicating: "#8b5cf6",
  learning: "#3b82f6",
  error: "#dc2626",
};

const ROLE_ICONS: Record<string, string> = {
  coordinator: "⊕",
  worker: "⚙",
  specialist: "◆",
  scout: "◎",
  synthesizer: "⬡",
  validator: "✓",
  witness: "👁",
  replicator: "⧫",
};

// =============================================================================
// LAYOUT ALGORITHM
// =============================================================================

function buildTree(agents: AgentNode[]): LayoutNode[] {
  const agentMap = new Map<AgentNodeId, AgentNode>();
  for (const agent of agents) {
    agentMap.set(agent.id, agent);
  }

  // Find root agents (no parent or parent not in this swarm)
  const roots: AgentNode[] = [];
  const childrenMap = new Map<AgentNodeId, AgentNode[]>();

  for (const agent of agents) {
    if (!agent.parentId || !agentMap.has(agent.parentId)) {
      roots.push(agent);
    } else {
      const siblings = childrenMap.get(agent.parentId) || [];
      siblings.push(agent);
      childrenMap.set(agent.parentId, siblings);
    }
  }

  function buildNode(agent: AgentNode): LayoutNode {
    const children = (childrenMap.get(agent.id) || []).map(buildNode);
    return { agent, x: 0, y: 0, children };
  }

  return roots.map(buildNode);
}

function layoutTree(roots: LayoutNode[]): { nodes: LayoutNode[]; width: number; height: number } {
  let nextX = 0;
  const allNodes: LayoutNode[] = [];

  function assignPositions(node: LayoutNode, depth: number) {
    node.y = depth * LEVEL_HEIGHT + PADDING;

    if (node.children.length === 0) {
      node.x = nextX * NODE_SPACING + PADDING;
      nextX++;
    } else {
      for (const child of node.children) {
        assignPositions(child, depth + 1);
      }
      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];
      node.x = (firstChild.x + lastChild.x) / 2;
    }

    allNodes.push(node);
  }

  for (const root of roots) {
    assignPositions(root, 0);
  }

  const maxX = allNodes.reduce((m, n) => Math.max(m, n.x), 0) + PADDING;
  const maxY = allNodes.reduce((m, n) => Math.max(m, n.y), 0) + PADDING;

  return {
    nodes: allNodes,
    width: Math.max(maxX + PADDING, 300),
    height: Math.max(maxY + PADDING, 200),
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SwarmNetworkGraph({
  agents,
  selectedAgentId,
  onSelectAgent,
}: SwarmNetworkGraphProps) {
  const layout = useMemo(() => {
    const roots = buildTree(agents);
    return layoutTree(roots);
  }, [agents]);

  const edges = useMemo(() => {
    const result: { from: LayoutNode; to: LayoutNode }[] = [];
    function collect(node: LayoutNode) {
      for (const child of node.children) {
        result.push({ from: node, to: child });
        collect(child);
      }
    }
    const roots = buildTree(agents);
    for (const root of roots) {
      // Re-use the layout positions
      const layoutMap = new Map<string, LayoutNode>();
      for (const n of layout.nodes) {
        layoutMap.set(n.agent.id, n);
      }
      function collectFromLayout(agent: AgentNode) {
        const parentNode = layoutMap.get(agent.id);
        if (!parentNode) return;
        const children =
          agents.filter((a) => a.parentId === agent.id);
        for (const child of children) {
          const childNode = layoutMap.get(child.id);
          if (childNode) {
            result.push({ from: parentNode, to: childNode });
          }
          collectFromLayout(child);
        }
      }
      collectFromLayout(root.agent);
    }
    // De-duplicate
    const seen = new Set<string>();
    return result.filter((e) => {
      const key = `${e.from.agent.id}->${e.to.agent.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [agents, layout.nodes]);

  const handleClick = useCallback(
    (agentId: AgentNodeId) => {
      onSelectAgent?.(agentId);
    },
    [onSelectAgent]
  );

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No agents in this swarm yet. Spawn an agent to see the network graph.
      </div>
    );
  }

  return (
    <div className="w-full overflow-auto border rounded-lg bg-background/50">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-w-full"
      >
        {/* Edges */}
        {edges.map((edge, i) => (
          <line
            key={`edge-${i}`}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
          />
        ))}

        {/* Nodes */}
        {layout.nodes.map((layoutNode) => {
          const { agent, x, y } = layoutNode;
          const color = STATUS_COLORS[agent.status] || "#6b7280";
          const isSelected = agent.id === selectedAgentId;
          const icon = ROLE_ICONS[agent.role] || "●";

          return (
            <g
              key={agent.id}
              transform={`translate(${x}, ${y})`}
              onClick={() => handleClick(agent.id)}
              className="cursor-pointer"
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  r={NODE_RADIUS + 4}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}

              {/* Node circle */}
              <circle
                r={NODE_RADIUS}
                fill={color}
                fillOpacity={0.15}
                stroke={color}
                strokeWidth={2}
              />

              {/* Role icon */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={16}
                fill={color}
              >
                {icon}
              </text>

              {/* Agent name */}
              <text
                y={NODE_RADIUS + 14}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.7}
                className="select-none"
              >
                {agent.name.length > 12
                  ? `${agent.name.slice(0, 11)}…`
                  : agent.name}
              </text>

              {/* Status indicator */}
              <circle
                cx={NODE_RADIUS - 4}
                cy={-NODE_RADIUS + 4}
                r={5}
                fill={color}
                stroke="var(--background)"
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
