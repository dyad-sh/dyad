import type * as tsModule from "typescript";

export type TypeScriptModule = typeof tsModule;

export type GraphNodeKind =
  | "file"
  | "class"
  | "interface"
  | "function"
  | "method"
  | "variable"
  | "property"
  | "type"
  | "enum";

export type GraphEdgeKind =
  | "contains"
  | "imports"
  | "calls"
  | "references"
  | "extends"
  | "implements";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphIndex {
  appPath: string;
  rootFileNames: string[];
  nodes: Map<string, GraphNode>;
  byName: Map<string, Set<string>>;
  byFile: Map<string, Set<string>>;
  edgesOut: Map<string, GraphEdge[]>;
  edgesIn: Map<string, GraphEdge[]>;
}

export interface SearchHit {
  nodeId: string;
  score: number;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function makeNodeId(node: {
  filePath: string;
  kind: string;
  qualifiedName: string;
  start: number;
}): string {
  return `${normalizePath(node.filePath)}#${node.kind}:${node.qualifiedName}:${node.start}`;
}
